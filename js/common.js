import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase, ref, onValue, push, set, update, remove, get,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig, YT_API_KEY, MAX_PENDING_PER_GUEST } from "./config.js?v=16";

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

// ---------- Bài đề xuất khi hết danh sách (giống autoplay YouTube) ----------
// YouTube đã bỏ API "video liên quan", nên lấy các bài nổi bật cùng kênh với bài vừa hát.
async function cached(key, loader) {
  const cRef = ref(db, `searchCache/${cacheKey(key)}`);
  try {
    const v = (await get(cRef)).val();
    if (v && Date.now() - v.t < CACHE_TTL) return v.items || [];
  } catch (_) {}
  const items = await loader();
  set(cRef, { t: Date.now(), items }).catch(() => {});
  return items;
}

async function ytApi(path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  url.search = new URLSearchParams({ ...params, key: YT_API_KEY });
  const res = await fetch(url);
  if (!res.ok) throw new Error("YouTube API lỗi " + res.status);
  return res.json();
}

const toItem = (it, id) => ({
  videoId: id,
  title: decodeEntities(it.snippet.title),
  channel: decodeEntities(it.snippet.channelTitle),
  thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || "",
});

async function channelPool(videoId) {
  try {
    const [info] = await cached(`vid_${videoId}`, async () => {
      const d = await ytApi("videos", { part: "snippet", id: videoId });
      return (d.items || []).map((it) => ({ channelId: it.snippet.channelId }));
    });
    if (!info?.channelId) return [];
    return await cached(`ch_${info.channelId}`, async () => {
      const d = await ytApi("search", {
        part: "snippet", type: "video", videoEmbeddable: "true", maxResults: "30",
        channelId: info.channelId, order: "viewCount",
      });
      return (d.items || []).map((it) => toItem(it, it.id.videoId));
    });
  } catch (_) { return []; }
}

async function popularPool() {
  try { return await searchYouTube("nhạc trẻ hay nhất", true); } catch (_) { return []; }
}

export async function suggestAfter(videoId, exclude) {
  let fresh = (await channelPool(videoId)).filter((v) => !exclude.has(v.videoId));
  if (!fresh.length) fresh = (await popularPool()).filter((v) => !exclude.has(v.videoId));
  if (!fresh.length) return null;
  // Chọn ngẫu nhiên trong nhóm phổ biến nhất để đỡ lặp lại.
  const top = fresh.slice(0, 10);
  return top[Math.floor(Math.random() * top.length)];
}

// Danh sách gợi ý khi ô tìm kiếm trống: bài cùng kênh với bài đang hát, rồi bài phổ biến.
export async function suggestionList(seedVideoId) {
  const seen = new Set();
  const out = [];
  const pools = [seedVideoId ? await channelPool(seedVideoId) : [], await popularPool()];
  for (const pool of pools) for (const v of pool) {
    if (out.length >= 20 || seen.has(v.videoId) || v.videoId === seedVideoId) continue;
    seen.add(v.videoId); out.push(v);
  }
  return out;
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

// Lưu tùy chọn trên trình duyệt này để giữ nguyên khi tải lại trang.
export const pref = {
  get(k, def) { try { const v = localStorage.getItem("karaoke-pref-" + k); return v === null ? def : JSON.parse(v); } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem("karaoke-pref-" + k, JSON.stringify(v)); } catch (_) {} },
};

// Gắn các tab "Danh sách / Tìm bài" và nhớ tab đang chọn.
export function wireTabs(page) {
  const btns = document.querySelectorAll("[data-tab]");
  const show = (tab) => {
    btns.forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
    $("#tab-queue").classList.toggle("hidden", tab !== "queue");
    $("#tab-search").classList.toggle("hidden", tab !== "search");
  };
  btns.forEach((b) => { b.onclick = () => { show(b.dataset.tab); pref.set(page + "-tab", b.dataset.tab); }; });
  const saved = pref.get(page + "-tab", null);
  if (saved === "queue" || saved === "search") show(saved);
}

export function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3500);
}

export function wireSearch(form, resultsEl, onPick, getTaken = () => new Set(), getSeed = () => null) {
  let mode = "suggest";
  let shownSeed;
  let token = 0;
  if (form.karaoke) {
    form.karaoke.checked = pref.get("karaoke-only", true);
    form.karaoke.onchange = () => pref.set("karaoke-only", form.karaoke.checked);
  }
  const showSuggestions = async (force = false) => {
    const seed = getSeed();
    if (!force && mode === "suggest" && seed === shownSeed) return;
    mode = "suggest"; shownSeed = seed;
    if (!resultsEl.querySelector(".song")) resultsEl.innerHTML = `<p class="muted">Đang tải gợi ý…</p>`;
    const my = ++token;
    const items = await suggestionList(seed);
    if (my !== token || mode !== "suggest" || form.q.value.trim()) return;
    if (!items.length) { resultsEl.innerHTML = ""; return; }
    renderResults(resultsEl, items, onPick, getTaken());
    resultsEl.insertAdjacentHTML("afterbegin", `<p class="muted small">✨ Gợi ý cho bạn${seed ? " (theo bài đang hát)" : ""}</p>`);
  };
  form.q.addEventListener("input", () => {
    if (!form.q.value.trim()) { pref.set("last-query", ""); showSuggestions(true); }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) return showSuggestions(true);
    mode = "search";
    pref.set("last-query", q);
    resultsEl.innerHTML = `<p class="muted">Đang tìm…</p>`;
    try {
      const items = await searchYouTube(q, form.karaoke ? form.karaoke.checked : true);
      renderResults(resultsEl, items, onPick, getTaken());
    } catch (err) {
      resultsEl.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  };
  // Gọi lại khi bài đang hát đổi để làm mới gợi ý (chỉ khi ô tìm kiếm đang trống).
  const last = pref.get("last-query", "");
  if (last) { form.q.value = last; form.requestSubmit ? form.requestSubmit() : form.onsubmit(new Event("submit")); }
  return () => { if (!form.q.value.trim()) showSuggestions(); };
}
