---
feature: channels
title: Channels
domain: message-hub
category: Core
status: stable
version: 1.0.2
owner: maintainers
last_verified: 2026-10-07
modules: [src/server/services/channels.ts, src/app/api/v1/channels, src/server/http/auth.ts, src/studio, scripts/reset-data.mjs]
entities: [channels]
routes: [GET/POST /api/v1/channels, GET/PATCH/DELETE /api/v1/channels/[id], PUT /api/v1/channels/[id]/webhook, POST /api/v1/channels/[id]/rotate-secret, GET /api/v1/channels/[id]/visitors, GET /api/widget/channels/[id]]
related_plans: []
related_features: [widget-sdk, conversations, webhooks, customization]
---

# Feature Spec: Channels

## A. Sản phẩm

### Tổng quan

Channel là đơn vị cấu hình của một widget chat. Ứng dụng chính tạo channel qua API cho từng workspace, nhận về `id` để dựng thẻ `<script src=".../embed/<id>.js">`, và khai báo `webhookUrl` để nhận tin của visitor. Người vận hành cũng có thể nhập API key tại Message Hub Studio (`/`) để xem, tạo, sửa và debug các channel thuộc key đó.

### Quyết định sản phẩm

- Nhiều dự án chính dùng chung một instance qua `API_KEYS=name:key,…`; `name` là `owner` và cô lập dữ liệu giữa các dự án.
- Không có bảng quản lý key; Message Hub Studio chỉ giữ key trong `sessionStorage` của tab. Xoay key bằng cách thêm key mới cùng tên rồi bỏ key cũ.
- Xóa channel xóa luôn visitor, tin nhắn, delivery và file của nó.

### User Stories

**US-1 — Tạo channel:** Là ứng dụng chính, tôi muốn tạo channel cho một workspace để workspace có script chat riêng.

**US-2 — Tùy biến:** Là ứng dụng chính, tôi muốn sửa từng phần `settings` mà không phải gửi lại toàn bộ.

**US-3 — Giới hạn site được nhúng:** Là chủ workspace, tôi muốn chỉ các domain của tôi nhúng được widget.

**US-4 — Biết đã nhúng thành công:** Là chủ workspace, tôi muốn thấy channel `connectedAt` sau khi script được tải lần đầu (và nhận webhook `channel.connected`).

**US-5 — Xoay secret webhook:** Là ứng dụng chính, tôi muốn đổi `webhookSecret` khi nghi ngờ bị lộ.

**US-6 — Kiểm tra trực quan:** Là người vận hành, tôi muốn dùng API key để xem toàn bộ channel, sửa cấu hình và xem preview mà không cần tự gọi API.

### Phạm vi

#### Trong phạm vi
- CRUD channel, lọc theo `ref`, phân trang, xoay secret.
- Message Hub Studio cho danh sách toàn bộ channel của API key, tạo/xóa channel, sửa metadata/settings/webhook và xem thông tin debug.
- `allowedOrigins` → `frame-ancestors` của trang chat.
- Cấu hình công khai chỉ đọc cho iframe/loader (`GET /api/widget/channels/[id]`).

#### Ngoài phạm vi
- Quản trị người dùng/agent, giao diện quản trị, thống kê.

### Quy tắc nghiệp vụ

**BR-1** — Mọi route `/api/v1` cần `Authorization: Bearer <apiKey>`; key không hợp lệ → 401. So sánh key bằng digest cố định độ dài (constant-time).

**BR-2** — Channel không thuộc `owner` của key được xem như không tồn tại (404 `CHANNEL_NOT_FOUND`), không phân biệt với id lạ.

**BR-3** — `settings` luôn được chuẩn hóa đủ trường; `PATCH settings` deep-merge, `null` xóa giá trị tùy chọn, trường lạ bị từ chối (400).

**BR-4** — `allowedOrigins` là danh sách origin dạng `https://example.com`, `http://localhost:3000` hoặc wildcard host `https://*.example.com`; có đường dẫn hoặc ký tự lạ bị từ chối. Rỗng = cho nhúng mọi nơi.

**BR-5** — `webhookUrl` chỉ nhận `http(s)`; `PUT /channels/[id]/webhook` chỉ thay URL (nhận `null` để tắt), không xoay secret. `webhookSecret` sinh tự động (`whsec_…`), trả về cho owner.

**BR-6** — `connectedAt` được ghi đúng một lần, ở lần đầu `/embed/<id>.js` được tải.

**BR-7** — Message Hub Studio gọi các API public hiện có từ browser, giữ API key trong state và `sessionStorage` của tab, không đưa key vào URL hoặc server-rendered payload.

### Tiêu chí nghiệm thu

**AC-1** — Hai API key khác `owner` không đọc/sửa/xóa được channel của nhau (test `tests/api-v1.test.ts`).

**AC-2** — Channel có `settings` rỗng hoặc hỏng vẫn trả object đầy đủ trường.

**AC-3** — Xóa channel xóa file của nó trên đĩa (`tests/files.test.ts`).

**AC-4** — API webhook riêng cập nhật/xóa URL, giữ nguyên secret, từ chối URL sai và channel của owner khác (`tests/api-v1.test.ts`).

**AC-5** — Message Hub Studio tải đủ danh sách phân trang, cho chọn/tạo/sửa/xóa channel và chỉ persist thay đổi form khi bấm Save; xóa cần xác nhận, tự chọn channel kế tiếp và hiển thị lỗi API tại giao diện.

---

## B. Tham chiếu kỹ thuật

### Code Map

| Vai trò | File |
|---|---|
| Schema | `src/server/db/schema.ts` (`channels`) |
| Service | `src/server/services/channels.ts` |
| Routes | `src/app/api/v1/channels/**`, `src/app/api/widget/channels/[id]/route.ts` |
| Auth | `src/server/http/auth.ts`, `src/server/config.ts` (`API_KEYS`) |
| Settings | `src/settings/` |
| Operator UI | `src/app/page.tsx`, `src/studio/ChannelStudio.tsx`, `src/studio/types.ts` |
| Reset dữ liệu vận hành | `scripts/reset-data.mjs` |

### Data Model

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id` | text | `ch_` + 22 ký tự ngẫu nhiên |
| `owner` | text | Tên API key tạo channel |
| `name`, `ref` | text | Tên; `ref` = id workspace phía dự án chính (index `(owner, ref)`) |
| `webhook_url`, `webhook_secret` | text | Đích webhook và khóa ký |
| `settings` | JSON | `ChannelSettings` (xem spec customization) |
| `allowed_origins` | JSON | Danh sách origin |
| `connected_at`, `created_at`, `updated_at` | integer (ms) | |

### API

| Route | Auth | Mô tả |
|---|---|---|
| `GET /api/v1/channels?ref=&limit=&offset=` | 🔑 | List của owner → `{ data, hasMore }` |
| `POST /api/v1/channels` | 🔑 | Tạo (`name`, `ref?`, `webhookUrl?`, `allowedOrigins?`, `settings?`) → 201 |
| `GET/PATCH/DELETE /api/v1/channels/[id]` | 🔑 | Chi tiết / sửa / xóa (204) |
| `PUT /api/v1/channels/[id]/webhook` | 🔑 | `{webhookUrl: http(s) URL \| null}`; chỉ cập nhật đích webhook |
| `POST /api/v1/channels/[id]/rotate-secret` | 🔑 | Sinh secret mới |
| `GET /api/v1/channels/[id]/visitors` | 🔑 | List visitor |
| `GET /api/widget/channels/[id]` | public | `{ id, name, settings }`, `ETag`, không có secret |

### Bất biến

- ID không đoán được; mọi truy vấn của dự án chính đi qua `getOwnedChannel(owner, id)`.
- Response không bao giờ chứa `token_hash` của visitor.

### Vấn đề đã biết

- Không chặn `webhookUrl` trỏ vào địa chỉ nội bộ (chủ ý: dự án chính có thể ở mạng nội bộ); worker không theo redirect.

### Vận hành

`node scripts/reset-data.mjs --confirm-reset` xóa toàn bộ bảng nghiệp vụ và uploaded files, reset autoincrement nhưng giữ bảng migration và `/data/backups`. Khi chạy trong container phải tạm chặn traffic và restart container ngay sau đó để xóa state trong memory.
