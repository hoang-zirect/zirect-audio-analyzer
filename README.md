# Zirect Audio Analyzer

Website phân tích trực tiếp hai file Demo và Reference ngay trong trình duyệt. Dữ liệu âm thanh không được tải lên máy chủ.

## Piano Relaxing

Chế độ Piano Relaxing có thể tạo **Zirect Piano Reference Profile** từ 5–10 bài đã tuyển chọn. Sau lần tạo đầu tiên, Demo mới có thể được so với vùng thống kê của cả thư viện mà không cần tải lại một file Reference riêng.

- Audio được giải mã và phân tích ngay trên thiết bị.
- Hồ sơ trong `localStorage` chỉ chứa BPM đã xác nhận và các đặc trưng tổng hợp; không chứa audio, waveform hay chuỗi nốt thô.
- Có thể xuất/nhập hồ sơ dưới dạng JSON để sao lưu hoặc chuyển trình duyệt.
- AI audio-to-note dùng [Spotify Basic Pitch TypeScript](https://github.com/spotify/basic-pitch-ts) để ước lượng top-voice. Đây không phải MIDI chính xác và điểm “phù hợp hồ sơ” không phải điểm chất lượng.

## Chạy trên máy

```bash
npm install
npm run dev
```

## Đăng lên GitHub Pages

Repository phải có đúng tên `zirect-audio-analyzer`. Workflow trong `.github/workflows/deploy.yml` sẽ tự build và triển khai sau mỗi lần push lên nhánh `main`.

Địa chỉ mặc định: `https://hoang-zirect.github.io/zirect-audio-analyzer/`

Xem hướng dẫn tiếng Việt trong file `HUONG-DAN-GITHUB.md`.
