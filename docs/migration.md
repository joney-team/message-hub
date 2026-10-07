# Migrate từ Message Hub v1

Tài liệu này dành cho hệ thống đang tích hợp Message Hub v1 và cần chuyển sang Message Hub hiện tại.

Message Hub không có compatibility layer cho route, payload, database hoặc widget cũ. Việc chuyển đổi là một lần cutover sang API, webhook và loader mới. Namespace `/api/v1` trong tài liệu hiện tại là **version của API mới**, không phải API của sản phẩm Message Hub v1.

Tài liệu liên quan:

- [Hướng dẫn tích hợp hiện tại](integration.md)
- [Triển khai và vận hành](deploy.md)
- [Feature Specs](prd/README.md)

## 1. Phạm vi migration

- Không import trực tiếp MongoDB hoặc dữ liệu hội thoại cũ vào SQLite.
- Tạo channel mới qua API hiện tại và lưu `channelId`, `webhookSecret` mới.
- Visitor cũ không giữ session; sau cutover website tạo visitor mới khi bắt đầu chat.
- Nếu cần lưu lịch sử, xuất và lưu trữ dữ liệu cũ ở hệ thống riêng trước khi tắt service cũ.
- Không chạy hai phiên bản cùng một hostname. Dùng hostname riêng trong thời gian kiểm thử rồi chuyển website sang `https://message-hub.example.com`.

## 2. Đối chiếu hợp đồng

| Message Hub v1 | Message Hub hiện tại |
|---|---|
| Header `x-api-key` | `Authorization: Bearer <apiKey>` |
| `GET/POST /channels`, `GET/PUT/DELETE /channels/:id` | `/api/v1/channels`, `/api/v1/channels/{id}`; cập nhật bằng `PATCH` từng phần |
| `widgetSettings` | `settings`, cấu trúc mới |
| `<script src="/channels/sdk/:id/main.js">` | `<script src="https://message-hub.example.com/embed/<channelId>.js">` |
| `client`, `clientId` (Mongo ObjectId) | `visitor`, id dạng `vis_…` |
| `GET /clients/:id` | `GET /api/v1/visitors/{id}`; webhook đã kèm `visitor.profile` |
| `POST /messages` với `clientId` | `POST /api/v1/visitors/{id}/messages` |
| `senderId`, `senderName` | `sender: { id, name, avatar }` |
| `GET /messages?clientId=&offset=` | `GET /api/v1/visitors/{id}/messages?before=` |
| `DELETE /messages/clean` | `DELETE /api/v1/visitors/{id}/messages` |
| `POST /files/upload` | `POST /api/v1/files` với `channelId` |
| Tin nhắn `type: CLIENT / CHANNEL` | `direction: inbound / outbound` |
| Attachment `{ type, url, raw }` | `{ fileId, name, mime, size, url }` |
| `_id`, `createdAt` dạng số giây | `id`, `createdAt` dạng ISO 8601 |
| Webhook `{ type, channelId, data }`, không chữ ký | `{ id, event, createdAt, channel, data }`, ký HMAC |
| Webhook `SDK_CONNECTED` | `channel.connected` |
| Đổi locale bằng cách chèn lại script | `MessageHub.setLocale(code)` |
| Bull Board `/queues`, Swagger `/docs` | API deliveries, Bruno và tài liệu trong repo |

## 3. Chuyển settings

| `widgetSettings` cũ | `settings` mới |
|---|---|
| `color` | `theme.color` |
| `position: 'LEFT' / 'RIGHT'` | `launcher.position: 'left' / 'right'` |
| `chatIcon` | `launcher.icon` |
| `brandLogo` | `theme.logo` |
| `brandName` | `content.brandName` theo locale |
| `welcomMessage` | `content.welcomeTitle` theo locale |
| `welcomSubMessage` | `content.welcomeSubtitle` theo locale |
| `locale` | `locales` và `defaultLocale` |
| `welcomeInputs[]` | `preChat.fields[]` và `preChat.mode` |
| `welcomeInputs[].fieldName` | `fields[].key` |
| `welcomeInputs[].isRequired` | `fields[].required` |
| `welcomeInputs[].type: 'PHONE'` | `fields[].type: 'phone'` |
| `welcomeInputs[].label`, `placeholder` | Giữ tên trường, đổi giá trị thành object theo locale |

Ví dụ:

```json
{
  "settings": {
    "theme": {
      "color": "#0f766e",
      "logo": "https://example.com/logo.png"
    },
    "launcher": {
      "position": "right"
    },
    "locales": ["vi", "en"],
    "defaultLocale": "vi",
    "content": {
      "brandName": {
        "vi": "Hỗ trợ",
        "en": "Support"
      }
    },
    "preChat": {
      "mode": "required",
      "fields": [
        {
          "key": "phone",
          "type": "phone",
          "required": true
        }
      ]
    }
  }
}
```

## 4. Chuyển webhook

1. Lưu `webhookSecret` khi tạo channel.
2. Bật raw body cho endpoint nhận webhook.
3. Kiểm `X-MessageHub-Signature` trước khi parse hoặc xử lý payload.
4. Khử trùng theo `X-MessageHub-Delivery` hoặc `data.message.id`.
5. Đọc `channel.ref`, `data.message.direction` và `data.visitor` trực tiếp từ payload; bỏ các request ngược để lấy channel/client.
6. Chỉ xử lý logic gửi vào hệ thống chính khi `direction` phù hợp, vì tin outbound cũng phát sự kiện `message.created`.

Chi tiết payload và mã kiểm chữ ký nằm trong [mục webhook của integration guide](integration.md#5-bước-3--nhận-webhook).

## 5. Chuyển file và tin trả lời

1. Upload file qua `POST https://message-hub.example.com/api/v1/files` với `channelId`.
2. Lấy `id` trả về và gửi trong `attachments: [{ "fileId": "file_…" }]`.
3. Trả lời visitor qua `POST /api/v1/visitors/{id}/messages`, kèm `sender`.
4. URL tải file dùng `https://files.message-hub.example.com/files/<id>`.

Không gửi URL file tùy ý trong attachment như hợp đồng cũ.

## 6. Chuyển widget website

Thay script cũ bằng:

```html
<script src="https://message-hub.example.com/embed/ch_xxx.js" async></script>
```

Khi website đổi ngôn ngữ:

```js
window.MessageHub.setLocale('vi');
```

Nếu website có CSP, cho phép:

```text
script-src https://message-hub.example.com;
frame-src https://message-hub.example.com;
```

## 7. Checklist cutover

- [ ] Tạo API key production mới.
- [ ] Tạo lại channel và lưu `channelId`, `webhookSecret`.
- [ ] Chuyển `widgetSettings` sang `settings`.
- [ ] Cập nhật endpoint webhook và kiểm chữ ký trên raw body.
- [ ] Cập nhật xử lý payload webhook và idempotency.
- [ ] Cập nhật API trả lời, typing và upload file.
- [ ] Cập nhật trang cài đặt từ `GET /api/v1/meta`.
- [ ] Cập nhật iframe preview và `content.overrides`.
- [ ] Thay script trên website và dùng `MessageHub.setLocale()`.
- [ ] Kiểm thử tạo visitor, gửi/nhận tin, file, webhook retry và locale.
- [ ] Chuyển traffic sang `message-hub.example.com`, theo dõi deliveries lỗi.
- [ ] Xuất dữ liệu cần lưu trữ rồi tắt hạ tầng cũ.
- [ ] Rotate API key, webhook secret, mật khẩu MongoDB và các secret cũ còn trong lịch sử git.

## 8. Sau cutover

- Không gọi các route cũ hoặc giữ fallback sang service cũ.
- Không dùng lại `clientId`, channel id hoặc webhook secret cũ.
- Xóa cấu hình MongoDB, Redis, Bull Board và service/widget cũ khỏi môi trường triển khai.
- Giữ bản export dữ liệu cũ theo chính sách lưu trữ của dự án chính, không đưa vào volume Message Hub mới.
