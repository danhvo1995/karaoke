import {
  db, ref, onValue, update, set, $, esc, param, roomUrl, isAdminUser, waitForUser, sortQueue, toast,
} from "./common.js?v=6";
import { QR_SECONDS } from "./config.js?v=6";

const roomId = param("r");
let queue = [];
let current = null;      // bài đang phát
let started = false;
let advancing = false;
let player = null;

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
  });

  onValue(ref(db, `rooms/${roomId}/queue`), (s) => {
    queue = sortQueue(s.val());
    renderNext();
    if (started && !current && queue.length) playNext();
  });

  // Lệnh từ admin (pause/play/skip) và yêu cầu qua bài từ khách.
  listenOnce(`rooms/${roomId}/cmd`, (c) => {
    if (!player) return;
    if (c.type === "pause") player.pauseVideo();
    else if (c.type === "play") player.playVideo();
    else if (c.type === "skip") playNext();
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
      onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED) playNext(); },
      onError: () => { toast("Video không phát được, chuyển bài tiếp theo"); setTimeout(playNext, 1500); },
    },
  });

  $("#start-btn").onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch (_) {}
    $("#start").classList.add("hidden");
    started = true;
    const snap = await new Promise((res) => onValue(ref(db, `rooms/${roomId}/now`), res, { onlyOnce: true }));
    const n = snap.val();
    if (n) { current = n; player.loadVideoById(n.videoId); showIdle(false); renderNow(); }
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
  try {
    const next = queue[0];
    if (!next) {
      current = null;
      await set(ref(db, `rooms/${roomId}/now`), null);
      player.stopVideo();
      showIdle(true);
    } else {
      current = { videoId: next.videoId, title: next.title, thumb: next.thumb || "", by: next.by, startedAt: Date.now() };
      await update(ref(db, `rooms/${roomId}`), { now: current, [`queue/${next.id}`]: null });
      player.loadVideoById(next.videoId);
      showIdle(false);
    }
    renderNow();
  } finally {
    advancing = false;
  }
}

function showIdle(on) { $("#idle").classList.toggle("hidden", !on); }

function renderNow() {
  $("#now-box").innerHTML = current
    ? `<span class="who">🎤 ${esc(current.by)}</span> · ${esc(current.title)}` : "";
}

function renderNext() {
  const n = queue[0];
  $("#next-box").innerHTML = n ? `Tiếp theo: <span class="who">🎤 ${esc(n.by)}</span> · ${esc(n.title)}` : "Tiếp theo: chưa có bài, quét mã QR để chọn bài!";
}

function tickOverlay() {
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
  $("#qr-box").classList.toggle("off", !show);
  $("#now-box").classList.toggle("hidden", !show);
  // "Tiếp theo" luôn hiện khi đang phát để mọi người biết bài kế.
  $("#next-box").classList.toggle("hidden", !current);
}
