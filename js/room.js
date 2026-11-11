import {
  auth, db, ref, onValue, set, remove, $, esc, param, waitForUser, signInAnonymously,
  sortQueue, addToQueue, prioritize, wireSearch, toast, markTaken, takenIds, wireTabs,
} from "./common.js?v=16";

const roomId = param("r");
let queue = [];
let now = null;
let refreshSuggest = () => {};
let meta = {};
let myName = "";

function loadName() { try { return localStorage.getItem("karaoke-name") || ""; } catch (_) { return ""; } }
function saveName(n) { try { localStorage.setItem("karaoke-name", n); } catch (_) {} }

function askName() {
  return new Promise((resolve) => {
    const m = $("#name-modal");
    const f = $("#name-form");
    f.name.value = myName;
    m.classList.remove("hidden");
    f.name.focus();
    f.onsubmit = (e) => {
      e.preventDefault();
      const n = f.name.value.trim().slice(0, 40);
      if (!n) return;
      myName = n; saveName(n); $("#me").textContent = n;
      m.classList.add("hidden");
      resolve(n);
    };
  });
}

(async () => {
  if (!roomId) { $("#room-name").textContent = "Link không hợp lệ"; return; }
  let u = await waitForUser();
  if (!u) u = (await signInAnonymously(auth)).user;

  myName = loadName();
  $("#me").textContent = myName;
  if (!myName) await askName();
  $("#rename").onclick = (e) => { e.preventDefault(); askName(); };

  onValue(ref(db, `rooms/${roomId}/meta`), (s) => {
    meta = s.val() || {};
    if (!s.exists()) { $("#room-name").textContent = "Room không tồn tại"; return; }
    $("#room-name").textContent = "🎤 " + meta.name;
    document.title = meta.name + " – Chọn bài";
    $("#closed").classList.toggle("hidden", !!meta.open);
    $("#skip").classList.toggle("hidden", !(meta.open && meta.allowGuestSkip));
    renderQueue();
  });

  onValue(ref(db, `rooms/${roomId}/now`), (s) => {
    const n = s.val();
    now = n;
    refreshSuggest();
    refreshTaken();
    $("#now").innerHTML = n
      ? `<img src="${esc(n.thumb)}" alt=""><div class="info"><div class="title">${esc(n.title)}</div><div class="muted small">🎤 ${esc(n.by)}</div></div>`
      : `<div class="info muted">Chưa có bài nào, chọn bài đầu tiên đi!</div>`;
  });

  onValue(ref(db, `rooms/${roomId}/queue`), (s) => { queue = sortQueue(s.val()); renderQueue(); renderNext(); refreshTaken(); });

  $("#skip").onclick = async () => {
    if (!confirm("Chuyển sang bài tiếp theo?")) return;
    try { await set(ref(db, `rooms/${roomId}/skipReq`), { at: Date.now(), by: myName }); }
    catch (_) { toast("Không được phép qua bài lúc này."); }
  };

  wireTabs("room");

  refreshSuggest = wireSearch($("#search-form"), $("#results"), async (video) => {
    if (!meta.open) throw new Error("Room đã đóng.");
    await addToQueue(roomId, video, myName, queue);
    const pos = queue.length + 1;
    toast(`Đã thêm! Bài của bạn đứng thứ ${pos} trong danh sách.`);
  }, () => takenIds(queue, now), () => now?.videoId || null);
  refreshSuggest();
})();

function renderQueue() {
  $("#qcount").textContent = queue.length;
  $("#qcount2").textContent = queue.length;
  const el = $("#queue");
  if (!el) return;
  if (!queue.length) { el.innerHTML = `<p class="muted">Danh sách trống.</p>`; return; }
  const uid = auth.currentUser?.uid;
  el.innerHTML = "";
  queue.forEach((q, i) => {
    const mine = q.byUid === uid;
    const row = document.createElement("div");
    row.className = "song";
    row.innerHTML = `<div class="idx">${i + 1}</div><img src="${esc(q.thumb)}" alt="">
      <div class="info"><div class="title">${esc(q.title)}</div><div class="muted small">🎤 ${esc(q.by)}${mine ? " (bạn)" : ""}</div></div>
      <div class="actions col"></div>`;
    const actions = row.querySelector(".actions");
    if (i === 0) {
      const t = document.createElement("span");
      t.className = "tag"; t.textContent = "Sắp hát";
      actions.appendChild(t);
    }
    if (meta.open && meta.allowGuestPriority && i > 0) {
      const b = document.createElement("button");
      b.className = "btn small"; b.textContent = "⤒ Ưu tiên"; b.title = "Đưa bài lên đầu danh sách";
      b.onclick = () => prioritize(roomId, q.id, queue).catch(() => toast("Không được phép ưu tiên lúc này."));
      actions.appendChild(b);
    }
    if (mine) {
      const b = document.createElement("button");
      b.className = "btn small danger"; b.textContent = "✕ Xóa"; b.title = "Xóa bài của bạn";
      b.onclick = () => { if (confirm(`Xóa bài "${q.title}" khỏi danh sách?`)) remove(ref(db, `rooms/${roomId}/queue/${q.id}`)); };
      actions.appendChild(b);
    }
    el.appendChild(row);
  });
}

function refreshTaken() { markTaken($("#results"), takenIds(queue, now)); }

function renderNext() {
  const n = queue[0];
  $("#next").innerHTML = n
    ? `<span class="muted">Tiếp theo:</span> <b>${esc(n.title)}</b> <span class="muted">· 🎤 ${esc(n.by)}</span>`
    : `<span class="muted">Tiếp theo: chưa có bài nào</span>`;
}
