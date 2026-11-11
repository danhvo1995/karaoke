import {
  db, ref, onValue, update, set, $, esc, param, roomUrl, isAdminUser, waitForUser, sortQueue, toast,
  suggestAfter,
} from "./common.js?v=12";
import { QR_SECONDS } from "./config.js?v=12";

const roomId = param("r");
let queue = [];
let current = null;      // bài đang phát
let started = false;
let advancing = false;
let player = null;
let qrManualUntil = 0;   // admin bấm "Hiện QR": hiện đến thời điểm này
let autoplay = true;     // tự phát bài đề xuất khi hết danh sách
let lastVideoId = null;  // bài vừa phát, dùng để tìm bài đề xuất
let autoErrors = 0;      // số lần liên tiếp bài đề xuất bị lỗi
const played = new Set();

function qrImg(text, cell) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createImgTag(cell, cell * 2);
}

function ytReady() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(); };
  });
}

(async () => {
  const u = await waitForUser();
  if (!isAdminUser(u) || !roomId) { location.href = "index.html"; return; }

  const guestUrl = roomUrl("room.html", roomId);
  $("#qr-big").innerHTML = qrImg(guestUrl, 8);
  $("#qr-small").innerHTML = qrImg(guestUrl, 6);

  onValue(ref(db, `rooms/${roomId}/meta`), (s) => {
    const m = s.val() || {};
    $("#idle-title").textContent = "🎤 " + (m.name || "Karaoke");
    $("#start-title").textContent = m.name || "Màn hình TV";
    autoplay = m.autoplay !== false;
    renderNext();
  });

  onValue(ref(db, `rooms/${roomId}/queue`), (s) => {
    queue = sortQueue(s.val());
    renderNext();
    if (started && queue.length && (!current)) playNext();
  });

  // Lệnh từ admin (pause/play/skip) và yêu cầu qua bài từ khách.
  listenOnce(`rooms/${roomId}/cmd`, (c) => {
    if (!player) return;
    if (c.type === "pause") player.pauseVideo();
    else if (c.type === "play") player.playVideo();
    else if (c.type === "skip") playNext();
    else if (c.type === "qr") qrManualUntil = Date.now() < qrManualUntil ? 0 : Date.now() + QR_SECONDS * 1000;
  });
  listenOnce(`rooms/${roomId}/skipReq`, (r) => {
    if (!current) return;
    toast(`⏭ ${r.by || "Khách"} đã chuyển bài`);
    playNext();
  });

  await ytReady();
  player = new YT.Player("player", {
    playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0 },
    events: {
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING) autoErrors = 0;
        if (e.data === YT.PlayerState.ENDED) playNext();
        // Báo trạng thái tạm dừng để nút trên trang admin hiển thị đúng.
        else syncPaused(e.data);
      },
      onError: () => {
        if (current?.auto) autoErrors++;
        toast("Video không phát được, chuyển bài tiếp theo");
        setTimeout(playNext, 1500);
      },
    },
  });

  $("#start-btn").onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch (_) {}
    $("#start").classList.add("hidden");
    started = true;
    const snap = await new Promise((res) => onValue(ref(db, `rooms/${roomId}/now`), res, { onlyOnce: true }));
    const n = snap.val();
    if (n) { current = n; lastVideoId = n.videoId; played.add(n.videoId); player.loadVideoById(n.videoId); showIdle(false); renderNow(); }
    else playNext();
  };

  setInterval(tickOverlay, 500);
})();

// Bỏ qua giá trị đang có lúc mở trang, chỉ phản ứng với thay đổi mới.
function listenOnce(path, fn) {
  let first = true, lastAt = null;
  onValue(ref(db, path), (s) => {
    const v = s.val();
    if (first) { first = false; lastAt = v?.at ?? null; return; }
    if (!v || v.at === lastAt) return;
    lastAt = v.at;
    fn(v);
  });
}

async function playNext() {
  if (advancing || !player) return;
  advancing = true;
  let retry = false;
  try {
    const next = queue[0];
    if (next) {
      autoErrors = 0;
      current = { videoId: next.videoId, title: next.title, thumb: next.thumb || "", by: next.by, startedAt: Date.now() };
      await update(ref(db, `rooms/${roomId}`), { now: current, [`queue/${next.id}`]: null });
    } else {
      const sug = autoplay && lastVideoId && autoErrors < 3 ? await suggestAfter(lastVideoId, played) : null;
      if (queue.length) { retry = true; return; } // có khách vừa thêm bài trong lúc tìm
      if (!sug) {
        current = null;
        await set(ref(db, `rooms/${roomId}/now`), null);
        player.stopVideo();
        showIdle(true);
        renderNow(); renderNext();
        return;
      }
      current = { videoId: sug.videoId, title: sug.title, thumb: sug.thumb || "", by: "Tự động", auto: true, startedAt: Date.now() };
      await set(ref(db, `rooms/${roomId}/now`), current);
    }
    lastVideoId = current.videoId;
    played.add(current.videoId);
    player.loadVideoById(current.videoId);
    showIdle(false);
    renderNow(); renderNext();
  } finally {
    advancing = false;
  }
  if (retry) playNext();
}

function showIdle(on) { $("#idle").classList.toggle("hidden", !on); }

function renderNow() {
  $("#now-box").innerHTML = current
    ? `Đang hát: <span class="who">🎤 ${esc(current.by)}</span> · ${esc(current.title)}` : "";
}

function renderNext() {
  const n = queue[0];
  $("#next-box").innerHTML = n
    ? `Tiếp theo: <span class="who">🎤 ${esc(n.by)}</span> · ${esc(n.title)}`
    : autoplay ? "Tiếp theo: bài đề xuất tự động · quét mã QR để chọn bài!" : "Tiếp theo: chưa có bài, quét mã QR để chọn bài!";
}

// Báo trạng thái tạm dừng lên Firebase để nút trên trang admin hiển thị đúng,
// kể cả khi dừng bằng cách bấm trực tiếp vào video trên TV.
function syncPaused(state) {
  if (!current || (state !== YT.PlayerState.PAUSED && state !== YT.PlayerState.PLAYING)) return;
  const paused = state === YT.PlayerState.PAUSED;
  if (!!current.paused === paused) return;
  current.paused = paused;
  update(ref(db, `rooms/${roomId}/now`), { paused }).catch(() => {});
}

function tickOverlay() {
  if (player && player.getPlayerState) syncPaused(player.getPlayerState());
  let show = false;
  if (current && player && player.getDuration) {
    const t = player.getCurrentTime() || 0;
    const d = player.getDuration() || 0;
    const Q = QR_SECONDS;
    if (d > 0) {
      const mid = d / 2;
      show = t < Q || t > d - Q || (d > 3 * Q && t >= mid - Q / 2 && t < mid + Q / 2);
    }
  }
  if (current && Date.now() < qrManualUntil) show = true;
  $("#qr-box").classList.toggle("off", !show);
  $("#now-box").classList.toggle("hidden", !show);
  // "Tiếp theo" luôn hiện khi đang phát để mọi người biết bài kế.
  $("#next-box").classList.toggle("hidden", !current);
}
