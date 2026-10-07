# Glossary — thuật ngữ Message Hub

| Thuật ngữ | Định nghĩa |
|---|---|
| **Channel** | Cấu hình một widget chat: `name`, `ref` (khóa map về workspace của ứng dụng chính), `webhookUrl` + `webhookSecret`, `settings`, `allowedOrigins`, `owner`. Bảng `channels`. ID dạng `ch_…`. |
| **Owner** | Tên của API key tạo ra channel (`API_KEYS=name:key`). Mỗi key chỉ thấy channel cùng `owner`. |
| **Visitor** | Người dùng ẩn danh trên website khách (trước đây gọi là *client*). Có `profile` tùy ý, `locale`, và một token bí mật. Bảng `visitors`, ID `vis_…`. |
| **Visitor token** | Chuỗi ngẫu nhiên 256-bit (`vt_…`) cấp một lần khi tạo session; chỉ lưu SHA-256. Gửi qua `Authorization: Bearer` cho `/api/widget/*`. |
| **Message** | Một tin nhắn. `direction`: `inbound` (visitor gửi) hoặc `outbound` (phía workspace/agent trả lời qua API). `seq` tăng dần dùng làm cursor và SSE event id. Bảng `messages`, ID `msg_…`. |
| **Loader** | Script `/embed/<channelId>.js` nhúng vào website khách: vẽ nút mở chat, tạo iframe khi mở lần đầu, cung cấp `window.MessageHub`. |
| **Chat page** | Trang `/w/<channelId>` (React) chạy trong iframe hoặc mở trực tiếp. `?preview=1` là chế độ xem trước. |
| **Webhook / Delivery** | `POST` có chữ ký từ hub tới `channel.webhookUrl`. Mỗi lần gửi là một dòng `webhook_deliveries` (outbox), trạng thái `pending` / `delivered` / `failed`. |
| **SSE stream** | `GET /api/widget/stream`: server-sent events đẩy tin mới và sự kiện "đang soạn" cho visitor. |
| **Settings** | `ChannelSettings` (theme, launcher, window, locales, content, preChat, features); luôn được chuẩn hóa đủ trường bằng zod. |
| **LocalizedText** | `{ "vi": "…", "en": "…" }` — chuỗi nội dung thuộc về channel, lùi về `defaultLocale`. |
| **Catalog** | Tập chuỗi giao diện theo ngôn ngữ (`src/i18n/messages/<locale>.json`); channel có thể ghi đè từng key (`content.overrides`). |
| **API key** | Giá trị trong `API_KEYS`, gửi qua `Authorization: Bearer` cho `/api/v1/*`. |
