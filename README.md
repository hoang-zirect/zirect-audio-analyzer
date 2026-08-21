# Zirect Audio Analyzer

Website phân tích trực tiếp hai file Demo và Reference ngay trong trình duyệt. Dữ liệu âm thanh không được tải lên máy chủ.

## Piano Relaxing

Chế độ Piano Relaxing có thể tạo **Zirect Piano Reference Profile** từ 5–10 bài đã tuyển chọn. Sau lần tạo đầu tiên, Demo mới có thể được so với vùng thống kê của cả thư viện mà không cần tải lại một file Reference riêng.

- Audio được giải mã và phân tích ngay trên thiết bị.
- Hồ sơ trong `localStorage` chỉ chứa BPM đề xuất/xác nhận, trạng thái đối chiếu và các đặc trưng tổng hợp; không chứa audio, waveform hay chuỗi nốt thô.
- Có thể xuất/nhập hồ sơ dưới dạng JSON để sao lưu hoặc chuyển trình duyệt.
- AI audio-to-note dùng [Spotify Basic Pitch TypeScript](https://github.com/spotify/basic-pitch-ts) để ước lượng top-voice cho Demo và Audio Reference (nếu có), kể cả khi chưa tạo hồ sơ dùng lại. Đây không phải MIDI chính xác và điểm “phù hợp hồ sơ” không phải điểm chất lượng.
- BPM audio được đối chiếu giữa bộ đo Zirect và [Essentia.js](https://mtg.github.io/essentia.js/). Essentia chạy trong Web Worker; quan hệ nửa/gấp đôi và các kết quả xung đột luôn được hiển thị để người nghe xác nhận thủ công.
- Hồ sơ chỉ đạt **Sẵn sàng đầy đủ** khi có đủ số bài và ít nhất 60% thư viện (tối thiểu 3 bài) có BPM đáng tin cậy cùng bản chép nốt AI. Hồ sơ thiếu các nguồn này vẫn so sánh được audio nhưng được gắn nhãn **Sẵn sàng giới hạn**; chỉ số thiếu mẫu không được đưa vào điểm phù hợp.

`essentia.js` được phân phối theo giấy phép AGPL-3.0; cần giữ việc phân phối và triển khai dự án phù hợp với giấy phép của dependency này.

## Chạy trên máy

```bash
npm install
npm run dev
```

Kiểm tra trước khi đưa lên production:

```bash
npm run lint
npm test
npm run build
npm run test:essentia-runtime
```

## Đăng lên GitHub Pages

Repository phải có đúng tên `zirect-audio-analyzer`. Workflow trong `.github/workflows/deploy.yml` sẽ tự build và triển khai sau mỗi lần push lên nhánh `main`.

Địa chỉ mặc định: `https://hoang-zirect.github.io/zirect-audio-analyzer/`

Xem hướng dẫn tiếng Việt trong file `HUONG-DAN-GITHUB.md`.
