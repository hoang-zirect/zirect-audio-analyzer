# Hướng dẫn đăng website bằng GitHub Desktop

## 1. Tạo repository trên máy

1. Mở GitHub Desktop.
2. Chọn **Create a New Repository on your local drive...**.
3. Điền **Name**: `zirect-audio-analyzer`.
4. **Local path**: chọn thư mục dễ tìm, ví dụ `Documents/GitHub`.
5. **Git ignore**: chọn `Node` nếu có; không có cũng không sao vì dự án đã kèm file `.gitignore`.
6. **License**: chọn `None`.
7. Nhấn **Create repository**.

## 2. Chép mã nguồn

1. Giải nén gói dự án đã tải.
2. Trong GitHub Desktop, chọn **Repository > Show in Explorer**.
3. Chép toàn bộ file và thư mục bên trong gói đã giải nén vào thư mục vừa mở.
4. Nếu Windows hỏi có ghi đè file không, chọn đồng ý.

Phải thấy các mục như `src`, `.github`, `package.json`, `vite.config.ts` trong thư mục repository.

## 3. Commit và Publish

1. Quay lại GitHub Desktop. Danh sách file thay đổi sẽ xuất hiện.
2. Ô **Summary**, nhập: `Initial Zirect Audio Analyzer`.
3. Nhấn **Commit to main**.
4. Nhấn **Publish repository**.
5. Giữ đúng tên `zirect-audio-analyzer`.
6. Với tài khoản GitHub miễn phí, bỏ chọn **Keep this code private** để GitHub Pages hoạt động đơn giản nhất.
7. Nhấn **Publish Repository**.

## 4. Bật GitHub Pages

1. Mở repository trên github.com.
2. Vào **Settings > Pages**.
3. Ở **Build and deployment > Source**, chọn **GitHub Actions**.
4. Mở tab **Actions**, chờ workflow có dấu tích xanh.
5. Truy cập `https://hoang-zirect.github.io/zirect-audio-analyzer/`.

## Lưu ý về tên miền riêng

Hãy kiểm tra website chạy ổn bằng địa chỉ GitHub Pages trước. Khi gắn tên miền riêng, cần đổi `base` trong `vite.config.ts` từ `/zirect-audio-analyzer/` thành `/`, sau đó commit lại. Việc cấu hình DNS sẽ được làm ở bước tiếp theo.
