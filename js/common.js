import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase, ref, onValue, push, set, update, remove, get,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig, YT_API_KEY, MAX_PENDING_PER_GUEST } from "./config.js?v=6";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export { ref, onValue, push, set, update, remove, get, signInAnonymously, signInWithEmailAndPassword, signOut };

export const $ = (sel, root = document) => root.querySelector(sel);
export const param = (name) => new URLSearchParams(location.search).get(name);
export const isAdminUser = (u) => !!u && !u.isAnonymous;

export function waitForUser() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function decodeEntities(s) {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

export function roomUrl(page, roomId) {
  return new URL(`${page}?r=${encodeURIComponent(roomId)}`, location.href).href;
}

export function sortQueue(obj) {
  return Object.entries(obj || {})
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => a.order - b.order);
}

// ---------- Tìm kiếm YouTube (có cache dùng chung trong Firebase) ----------
const CACHE_TTL = 7 * 24 * 3600 * 1000;

function cacheKey(q) {
  return q.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.#$\[\]\/]/g, "_").slice(0, 200);
}

export async function searchYouTube(query, karaoke = true) {
  const q = (karaoke && !/karaoke/i.test(query) ? `${query} karaoke` : query).trim();
  if (!q) return [];
  const key = cacheKey(q);
  const cRef = ref(db, `searchCache/${key}`);
  try {
    const snap = await get(cRef);
    const v = snap.val();
    if (v && Date.now() - v.t < CACHE_TTL) return v.items || [];
  } catch (_) { /* bỏ qua lỗi cache */ }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet", type: "video", videoEmbeddable: "true", maxResults: "15",
    q, key: YT_API_KEY, regionCode: "VN", relevanceLanguage: "vi",
  });
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const reason = err?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded") throw new Error("Đã hết lượt tìm kiếm YouTube hôm nay. Thử lại ngày mai hoặc tìm từ khóa đã có người tìm.");
    throw new Error("Không tìm được: " + (err?.error?.message || res.status));
  }
  const data = await res.json();
  const items = (data.items || []).map((it) => ({
    videoId: it.id.videoId,
    title: decodeEntities(it.snippet.title),
    channel: decodeEntities(it.snippet.channelTitle),
    thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || "",
  }));
  set(cRef, { t: Date.now(), items }).catch(() => {});
  return items;
}

// ---------- Hàng đợi ----------
export async function addToQueue(roomId, video, byName, queueArr, { admin = false } = {}) {
  const uid = auth.currentUser.uid;
  if (queueArr.some((q) => q.videoId === video.videoId)) throw new Error("Bài này đã có trong danh sách.");
  if (!admin && queueArr.filter((q) => q.byUid === uid).length >= MAX_PENDING_PER_GUEST) {
    throw new Error(`Bạn đã có ${MAX_PENDING_PER_GUEST} bài đang chờ. Đợi hát xong rồi chọn tiếp nhé.`);
  }
  await push(ref(db, `rooms/${roomId}/queue`), {
    videoId: video.videoId, title: video.title.slice(0, 300), thumb: video.thumb || "",
    by: byName.slice(0, 40), byUid: uid, order: Date.now(),
  });
}

export async function prioritize(roomId, itemId, queueArr) {
  const min = queueArr.length ? Math.min(...queueArr.map((q) => q.order)) : Date.now();
  await set(ref(db, `rooms/${roomId}/queue/${itemId}/order`), min - 1);
}

// ---------- Giao diện kết quả tìm kiếm ----------
export function renderResults(container, items, onPick, taken = new Set()) {
  container.innerHTML = items.length ? "" : `<p class="muted">Không có kết quả.</p>`;
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "song";
    row.innerHTML = `<img src="${esc(it.thumb)}" alt="" loading="lazy">
      <div class="info"><div class="title">${esc(it.title)}</div><div class="muted small">${esc(it.channel)}</div></div>
      <button class="btn primary"></button>`;
    const btn = row.querySelector("button");
    btn.dataset.vid = it.videoId;
    btn.onclick = async () => {
      btn.disabled = true;
      try { await onPick(it); setBtn(btn, true); }
      catch (e) { toast(e.message); btn.disabled = false; }
    };
    setBtn(btn, taken.has(it.videoId));
    container.appendChild(row);
  }
}

function setBtn(btn, isTaken) {
  btn.disabled = isTaken;
  btn.textContent = isTaken ? "Đã có" : "Thêm";
  btn.classList.toggle("primary", !isTaken);
}

// Cập nhật nút "Thêm"/"Đã có" khi danh sách phát thay đổi.
export function markTaken(container, taken) {
  container.querySelectorAll("button[data-vid]").forEach((b) => setBtn(b, taken.has(b.dataset.vid)));
}

// Các videoId đang có trong danh sách hoặc đang phát.
export function takenIds(queueArr, now) {
  const s = new Set(queueArr.map((q) => q.videoId));
  if (now?.videoId) s.add(now.videoId);
  return s;
}

export function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3500);
}

export function wireSearch(form, resultsEl, onPick, getTaken = () => new Set()) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) return;
    resultsEl.innerHTML = `<p class="muted">Đang tìm…</p>`;
    try {
      const items = await searchYouTube(q, form.karaoke ? form.karaoke.checked : true);
      renderResults(resultsEl, items, onPick, getTaken());
    } catch (err) {
      resultsEl.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  };
}
