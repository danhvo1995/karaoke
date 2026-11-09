// Điền các giá trị lấy từ Firebase và Google Cloud vào đây.
export const firebaseConfig = {
  apiKey: "AIzaSyCbjDtyYyieGTAEQapT7sR9I4HA5J2R9MA",
  authDomain: "karaoke-2b346.firebaseapp.com",
  databaseURL: "https://karaoke-2b346-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "karaoke-2b346",
  storageBucket: "karaoke-2b346.firebasestorage.app",
  messagingSenderId: "342773829340",
  appId: "1:342773829340:web:5504ece11180af6006ee19",
};

// YouTube Data API v3 key (khóa theo HTTP referrer = trang github.io của bạn).
export const YT_API_KEY = "AIzaSyAgS5zYQax1yIAzkGqEblPJQ8K6SoyT64c";

// Số bài tối đa một khách được có trong hàng đợi cùng lúc.
export const MAX_PENDING_PER_GUEST = 3;

// Thời gian hiện QR mỗi lần (giây): đầu bài, giữa bài, cuối bài.
export const QR_SECONDS = 30;
