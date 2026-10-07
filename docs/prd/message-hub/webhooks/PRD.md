---
feature: webhooks
title: Webhook và hàng đợi outbox
domain: message-hub
category: Integration
status: stable
version: 1.0.0
owner: maintainers
last_verified: 2026-10-07
modules: [src/server/queue, src/server/services/deliveries.ts, src/app/api/v1/deliveries, src/instrumentation-node.ts]
entities: [webhook_deliveries]
routes: [GET /api/v1/deliveries, POST /api/v1/deliveries/[id]/retry]
related_plans: []
related_features: [channels, conversations]
---

# Feature Spec: Webhook và hàng đợi outbox

## A. Sản phẩm

### Tổng quan

Mỗi sự kiện đáng chú ý (tin nhắn mới, visitor mới/cập nhật, channel được nhúng lần đầu) được gửi tới `channel.webhookUrl` bằng `POST` JSON có chữ ký HMAC. Hàng đợi là một bảng trong SQLite nên không có tin đã lưu mà mất webhook, và bản ghi chưa gửi chạy tiếp sau khi khởi động lại.

### Quyết định sản phẩm

- Ngữ nghĩa **at-least-once**; receiver khử trùng bằng `X-MessageHub-Delivery` hoặc `message.id`.
- Cả tin `inbound` và `outbound` đều có webhook để ứng dụng chính đồng bộ đầy đủ hội thoại.
- Payload mang sẵn `channel.ref` và `visitor.profile` để receiver không phải gọi ngược API.

### User Stories

**US-1 — Nhận tin:** Là ứng dụng chính, tôi muốn nhận mỗi tin của visitor kèm ngữ cảnh trang và ngôn ngữ.

**US-2 — Xác thực nguồn:** Là ứng dụng chính, tôi muốn kiểm chữ ký để chắc webhook đến từ Message Hub.

**US-3 — Theo dõi lỗi:** Là vận hành, tôi muốn xem delivery lỗi và gửi lại.

### Phạm vi

- Trong: outbox, worker, retry, chữ ký, API deliveries, dọn bản ghi cũ, tắt an toàn.
- Ngoài: nhiều đích cho một channel, lọc sự kiện theo đăng ký.

### Quy tắc nghiệp vụ

**BR-1** — Dòng outbox được ghi trong **cùng transaction** với dữ liệu gây ra sự kiện; channel không có `webhookUrl` thì không ghi.

**BR-2** — Sự kiện: `message.created`, `visitor.created`, `visitor.updated`, `channel.connected`. Tin `inbound` có `data.message.context`.

**BR-3** — Header: `X-MessageHub-Event`, `X-MessageHub-Delivery`, `X-MessageHub-Signature: t=<unix s>,v1=<hex HMAC-SHA256(webhookSecret, "t.body")>`. Body gồm `id` (= delivery id), `event`, `createdAt`, `channel {id, ref}`, `data`.

**BR-4** — Tuần tự theo channel (chỉ delivery `pending` cũ nhất của channel được chạy); các channel chạy song song tối đa 5; `failed` không chặn các delivery sau.

**BR-5** — Timeout 10 giây, không theo redirect (3xx = lỗi); 2xx = `delivered`. Tối đa 6 lần, chờ 10 s → 1 m → 5 m → 30 m → 2 h giữa các lần; hết lượt = `failed`.

**BR-6** — Worker poll mỗi 2 giây và được đánh thức khi có bản ghi mới. Xóa `delivered` sau 7 ngày (mỗi giờ).

**BR-7** — `SIGTERM`: dừng nhận việc mới, chờ request đang bay (tối đa 5 s), đóng stream, đóng DB.

**BR-8** — Message Hub Studio hiển thị 100 delivery mới nhất của channel đang chọn, tự refresh mỗi 5 giây, lọc theo trạng thái và cho phép đưa delivery `pending`/`failed` về hàng đợi ngay.

### Tiêu chí nghiệm thu

**AC-1** — Retry/backoff đúng lịch với đồng hồ giả; thứ tự trong channel giữ nguyên; `pending` chạy tiếp sau restart; chữ ký kiểm được (`tests/queue.test.ts`).

**AC-2** — Receiver thật nhận `visitor.created`, `message.created` (inbound + outbound) với chữ ký hợp lệ khi chạy `next start` (đã kiểm 2026-10-07).

**AC-3** — Studio theo dõi delivery theo channel, hiển thị attempts/HTTP/error/timestamps và gọi endpoint retry cho delivery chưa thành công.

---

## B. Tham chiếu kỹ thuật

### Code Map

| Vai trò | File |
|---|---|
| Ghi outbox, dựng payload | `src/server/queue/outbox.ts` |
| Worker | `src/server/queue/worker.ts` |
| Chữ ký và hàm kiểm | `src/server/queue/signature.ts` |
| API | `src/server/services/deliveries.ts`, `src/app/api/v1/deliveries/**` |
| Theo dõi trong Studio | `src/studio/ChannelStudio.tsx` |
| Khởi động/tắt | `src/instrumentation.ts`, `src/instrumentation-node.ts` |

### Data Model

`webhook_deliveries(id autoincrement, channel_id, event, payload JSON, status, attempts, next_attempt_at, last_status, last_error, created_at, delivered_at)`; index `(status, next_attempt_at)` và `(channel_id, status, id)`.

### API

| Route | Auth | Mô tả |
|---|---|---|
| `GET /api/v1/deliveries?status=&channelId=` | 🔑 | List của owner |
| `POST /api/v1/deliveries/[id]/retry` | 🔑 | Đưa `failed`/`pending` về hàng đợi (409 nếu đã `delivered`) |

### Bất biến

- Một delivery chỉ bị một worker xử lý (một process).
- `X-MessageHub-Delivery` là khóa khử trùng ổn định cho mọi lần gửi lại.

### Vấn đề đã biết

- URL file trong payload tương đối nếu không đặt `PUBLIC_URL`/`FILES_BASE_URL`.
- Không chặn đích nội bộ (chủ ý), nhưng không theo redirect.

### Vận hành

Worker luôn ghi structured error log ra stderr khi một lần gửi webhook thất bại, kể cả khi `DEBUG_LOG=false`; log gồm `deliveryId`, `channelId`, `webhookEvent`, attempt, HTTP status/reason và trạng thái hết lượt retry. Khi `DEBUG_LOG=true`, worker ghi thêm lifecycle, lần gửi, kết quả delivery, retry/thất bại và số bản ghi đã dọn. Log webhook không chứa URL đích, payload, secret hoặc nội dung tin nhắn.
