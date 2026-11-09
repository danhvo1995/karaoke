import {
  auth, db, ref, onValue, set, update, remove, $, esc, roomUrl, isAdminUser, toast,
  signInWithEmailAndPassword, signOut,
} from "./common.js?v=8";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

let offRooms = null;

onAuthStateChanged(auth, (u) => {
  const admin = isAdminUser(u);
  $("#login").classList.toggle("hidden", admin);
  $("#main").classList.toggle("hidden", !admin);
  if (offRooms) { offRooms(); offRooms = null; }
  if (admin) {
    $("#who").textContent = `Đăng nhập: ${u.email}`;
    offRooms = onValue(ref(db, "rooms"), (s) => renderRooms(s.val() || {}),
      (e) => { $("#rooms").innerHTML = `<p class="error">Không đọc được danh sách room (${esc(e.message)}). Kiểm tra lại Rules.</p>`; });
  }
});

$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  $("#login-err").textContent = "";
  try { await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value); }
  catch (err) { $("#login-err").textContent = "Sai email hoặc mật khẩu."; }
};
$("#logout").onclick = () => signOut(auth);

function newId() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

$("#create-form").onsubmit = async (e) => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  const id = newId();
  await set(ref(db, `rooms/${id}/meta`), {
    name, createdAt: Date.now(), open: true, allowGuestSkip: true, allowGuestPriority: true,
  });
  e.target.reset();
  toast("Đã tạo room " + name);
};

function renderRooms(rooms) {
  const list = Object.entries(rooms)
    .map(([id, r]) => ({ id, ...(r.meta || {}), queueLen: Object.keys(r.queue || {}).length, now: r.now }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const el = $("#rooms");
  if (!list.length) { el.innerHTML = `<p class="muted">Chưa có room nào.</p>`; return; }
  el.innerHTML = "";
  for (const r of list) {
    const div = document.createElement("div");
    div.className = "panel";
    div.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div><b>${esc(r.name)}</b> <span class="tag ${r.open ? "on" : "off"}">${r.open ? "Đang mở" : "Đã đóng"}</span>
          <div class="muted small">Mã: ${r.id} · ${r.queueLen} bài chờ${r.now ? " · Đang phát: " + esc(r.now.title) : ""}</div></div>
      </div>
      <div class="row" style="margin-top:10px">
        <a class="btn primary" href="${roomUrl("admin.html", r.id)}">Quản lý</a>
        <a class="btn" href="${roomUrl("tv.html", r.id)}" target="_blank" rel="noopener">Mở màn hình TV</a>
        <button class="btn" data-a="copy">Copy link khách</button>
        <button class="btn" data-a="toggle">${r.open ? "Đóng room" : "Mở lại"}</button>
        <button class="btn danger" data-a="del">Xóa</button>
      </div>`;
    div.querySelector('[data-a=copy]').onclick = () => {
      navigator.clipboard.writeText(roomUrl("room.html", r.id)).then(() => toast("Đã copy link khách"));
    };
    div.querySelector('[data-a=toggle]').onclick = () => update(ref(db, `rooms/${r.id}/meta`), { open: !r.open });
    div.querySelector('[data-a=del]').onclick = () => {
      if (confirm(`Xóa room "${r.name}"? Không khôi phục được.`)) remove(ref(db, `rooms/${r.id}`));
    };
    el.appendChild(div);
  }
}
