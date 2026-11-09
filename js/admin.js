import {
  db, ref, onValue, set, update, remove, $, esc, param, roomUrl, isAdminUser, waitForUser,
  sortQueue, addToQueue, prioritize, wireSearch, toast, markTaken, takenIds,
} from "./common.js?v=8";

const roomId = param("r");
let queue = [];
let now = null;

(async () => {
  const u = await waitForUser();
  if (!isAdminUser(u) || !roomId) { location.href = "index.html"; return; }

  $("#tv-link").href = roomUrl("tv.html", roomId);
  const guest = roomUrl("room.html", roomId);
  $("#guest-link").href = guest;
  $("#guest-link").textContent = guest;
  $("#copy").onclick = () => navigator.clipboard.writeText(guest).then(() => toast("Đã copy"));

  onValue(ref(db, `rooms/${roomId}/meta`), (s) => {
    const m = s.val();
    if (!m) { $("#room-name").textContent = "Room không tồn tại"; return; }
    $("#room-name").textContent = m.name;
    document.title = m.name + " – Karaoke";
    $("#open").checked = !!m.open;
    $("#allowSkip").checked = !!m.allowGuestSkip;
    $("#allowPrio").checked = !!m.allowGuestPriority;
  });
  const meta = (k) => (e) => update(ref(db, `rooms/${roomId}/meta`), { [k]: e.target.checked });
  $("#open").onchange = meta("open");
  $("#allowSkip").onchange = meta("allowGuestSkip");
  $("#allowPrio").onchange = meta("allowGuestPriority");

  onValue(ref(db, `rooms/${roomId}/now`), (s) => {
    const n = s.val();
    now = n;
    $("#toggle").textContent = n?.paused ? "▶ Tiếp tục" : "⏸ Tạm dừng";
    $("#toggle").disabled = !n;
    refreshTaken();
    $("#now").innerHTML = n
      ? `<img src="${esc(n.thumb)}" alt=""><div class="info"><div class="title">${esc(n.title)}</div><div class="muted small">🎤 ${esc(n.by)}</div></div>`
      : `<div class="info muted">Chưa phát bài nào. Hãy mở màn hình TV và bấm Bắt đầu.</div>`;
  });

  onValue(ref(db, `rooms/${roomId}/queue`), (s) => { queue = sortQueue(s.val()); renderQueue(); renderNext(); refreshTaken(); });

  $("#toggle").onclick = () =>
    set(ref(db, `rooms/${roomId}/cmd`), { type: now?.paused ? "play" : "pause", at: Date.now() });

  document.querySelectorAll("[data-cmd]").forEach((b) => {
    b.onclick = () => set(ref(db, `rooms/${roomId}/cmd`), { type: b.dataset.cmd, at: Date.now() });
  });

  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
      $("#tab-queue").classList.toggle("hidden", b.dataset.tab !== "queue");
      $("#tab-search").classList.toggle("hidden", b.dataset.tab !== "search");
    };
  });

  wireSearch($("#search-form"), $("#results"), async (video) => {
    await addToQueue(roomId, video, "MC", queue, { admin: true });
    toast("Đã thêm: " + video.title);
  }, () => takenIds(queue, now));
})();

function swap(i, j) {
  const a = queue[i], b = queue[j];
  if (!a || !b) return;
  update(ref(db, `rooms/${roomId}/queue`), { [`${a.id}/order`]: b.order, [`${b.id}/order`]: a.order });
}

function renderQueue() {
  $("#qcount").textContent = queue.length;
  const el = $("#queue");
  if (!queue.length) { el.innerHTML = `<p class="muted">Danh sách trống.</p>`; return; }
  el.innerHTML = "";
  queue.forEach((q, i) => {
    const row = document.createElement("div");
    row.className = "song";
    row.innerHTML = `<div class="idx">${i + 1}</div><img src="${esc(q.thumb)}" alt="">
      <div class="info"><div class="title">${esc(q.title)}</div><div class="muted small">🎤 ${esc(q.by)}</div></div>
      <div class="actions">
        <button class="btn small" data-a="playnow" title="Phát ngay">▶</button>
        <button class="btn small" data-a="top" title="Lên đầu">⤒</button>
        <button class="btn small" data-a="up" title="Lên">↑</button>
        <button class="btn small" data-a="down" title="Xuống">↓</button>
        <button class="btn small danger" data-a="del" title="Xóa">✕</button>
      </div>`;
    const on = (a, fn) => { row.querySelector(`[data-a=${a}]`).onclick = fn; };
    on("playnow", async () => {
      await prioritize(roomId, q.id, queue);
      await set(ref(db, `rooms/${roomId}/cmd`), { type: "skip", at: Date.now() });
    });
    on("top", () => prioritize(roomId, q.id, queue));
    on("up", () => swap(i, i - 1));
    on("down", () => swap(i, i + 1));
    on("del", () => { if (confirm(`Xóa bài "${q.title}" (${q.by} chọn) khỏi danh sách?`)) remove(ref(db, `rooms/${roomId}/queue/${q.id}`)); });
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
