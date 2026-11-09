# Karaoke đám cưới

Web chọn bài karaoke từ YouTube, chạy hoàn toàn trên GitHub Pages + Firebase (gói miễn phí).

## Các trang

| Trang | Ai dùng | Làm gì |
|---|---|---|
| `index.html` | Admin (laptop) | Đăng nhập, tạo / đóng / xóa room |
| `admin.html?r=<mã>` | Admin (laptop) | Quản lý hàng đợi, tạm dừng, qua bài, bật/tắt quyền khách |
| `tv.html?r=<mã>` | Màn hình TV | Phát video toàn màn hình, QR 3 lần mỗi bài, hiện tên người chọn |
| `room.html?r=<mã>` | Khách (điện thoại) | Nhập tên, tìm bài, thêm, ưu tiên, qua bài. Không phát tiếng, không tạm dừng |

## Cách dùng tại đám cưới

1. Laptop nối TV (chế độ Extend). Mở `index.html`, đăng nhập, tạo room.
2. Bấm **Mở màn hình TV**, kéo cửa sổ mới sang TV, bấm **Bắt đầu**.
3. Trên laptop bấm **Quản lý** để điều khiển. Khách quét QR trên TV để chọn bài.

## Cài đặt

1. Điền `js/config.js`: `firebaseConfig` (Firebase → Project settings → Your apps) và `YT_API_KEY`.
2. Firebase → Realtime Database → Rules: dán nội dung `database.rules.json`, thay `ADMIN_EMAIL` bằng email admin.
3. Firebase → Authentication: bật Email/Password và Anonymous; thêm user admin.
4. Firebase → Authentication → Settings → Authorized domains: thêm `<tên-github>.github.io`.
5. GitHub → Settings → Pages: Deploy from branch `main`, thư mục `/ (root)`.
6. Google Cloud → Credentials → API key → Website restrictions: `https://<tên-github>.github.io/*`.

## Dữ liệu (Realtime Database)

```
rooms/<mã>/meta     { name, createdAt, open, allowGuestSkip, allowGuestPriority }
rooms/<mã>/queue/*  { videoId, title, thumb, by, byUid, order }   // order nhỏ phát trước
rooms/<mã>/now      bài đang phát (do trang TV ghi)
rooms/<mã>/cmd      lệnh admin { type: pause|play|skip, at }
rooms/<mã>/skipReq  khách yêu cầu qua bài { at, by }
searchCache/<từ khóa>  kết quả tìm YouTube lưu 7 ngày để tiết kiệm quota
```
