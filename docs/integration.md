# Hướng dẫn tích hợp Message Hub

Tài liệu dành cho đội phát triển **ứng dụng chính** muốn đưa khung chat của Message Hub lên website của khách hàng và nhận, trả lời tin nhắn từ hệ thống của mình.

Đi theo thứ tự từ trên xuống là có một tích hợp chạy được. Phần tham chiếu chi tiết nằm ở cuối.

- [1. Tổng quan](#1-tổng-quan)
- [2. Chuẩn bị](#2-chuẩn-bị)
- [3. Bước 1 — Tạo channel](#3-bước-1--tạo-channel)
- [4. Bước 2 — Nhúng widget vào website](#4-bước-2--nhúng-widget-vào-website)
- [5. Bước 3 — Nhận webhook](#5-bước-3--nhận-webhook)
- [6. Bước 4 — Trả lời visitor](#6-bước-4--trả-lời-visitor)
- [7. Bước 5 — Tùy biến giao diện và nội dung](#7-bước-5--tùy-biến-giao-diện-và-nội-dung)
- [8. Tham chiếu API](#8-tham-chiếu-api)
- [9. Widget không hiện: cách kiểm tra](#9-widget-không-hiện-cách-kiểm-tra)
- [10. Lưu ý vận hành](#10-lưu-ý-vận-hành)

Trong tài liệu, Message Hub dùng `https://message-hub.example.com` và `API_KEY` là key của dự án chính.

Đây là hợp đồng runtime duy nhất được hỗ trợ. Nâng cấp tích hợp hiện có theo [hướng dẫn migration](migration.md).

| Dịch vụ | URL production |
|---|---|
| API, loader và widget | `https://message-hub.example.com` |
| File đính kèm | `https://files.message-hub.example.com` |

Upload vẫn gọi `/api/v1/files` hoặc `/api/widget/files` trên `message-hub.example.com`; URL tải file trong API và webhook dùng `files.message-hub.example.com` khi đặt `FILES_BASE_URL=https://files.message-hub.example.com`. Cả hai domain trỏ vào cùng app, cổng 4200.

---

## 1. Tổng quan

```
 Website khách                     Message Hub                      Dự án chính
┌───────────────────┐        ┌───────────────────────┐        ┌───────────────────────┐
│ <script embed.js> │──────▶ │ widget + API + queue  │──────▶ │ webhook (có chữ ký)   │
│  khung chat       │ ◀───── │ SQLite, một instance  │ ◀───── │ POST …/messages       │
└───────────────────┘  SSE   └───────────────────────┘  API   └───────────────────────┘
```

Ba khái niệm:

| Khái niệm | Ý nghĩa | ID |
|---|---|---|
| **Channel** | Một widget chat cùng cấu hình của nó. Thường mỗi workspace một channel; trường `ref` giữ id workspace phía bạn | `ch_…` |
| **Visitor** | Một người ẩn danh đang chat trên một channel | `vis_…` |
| **Message** | Tin nhắn, có `direction` là `inbound` (visitor gửi) hoặc `outbound` (bạn trả lời) | `msg_…` |

Luồng hoạt động:

1. Bạn tạo channel qua API, nhận về `id` và `webhookSecret`.
2. Website khách nhúng một thẻ `<script>`.
3. Visitor nhắn tin. Message Hub gọi webhook của bạn cho mỗi sự kiện.
4. Bạn trả lời qua API. Tin hiện ngay trong khung chat của visitor.

---

## 2. Chuẩn bị

Bạn cần ba thứ:

1. **Địa chỉ Message Hub:** `https://message-hub.example.com`, chạy HTTPS ở production.
2. **API key.** Người vận hành Message Hub khai báo trong biến môi trường:

   ```
   API_KEYS=admin:<chuỗi-ngẫu-nhiên-từ-16-ký-tự>
   ```

   Phần trước dấu `:` là tên chủ sở hữu (`owner`). Mỗi key chỉ thấy và sửa được channel do chính nó tạo. Có thể khai báo nhiều key, kể cả nhiều key cùng tên để xoay key mà không gián đoạn.
3. **Một endpoint nhận webhook** ở phía bạn mà Message Hub gọi tới được, ví dụ `https://api.example.com/plugins/message-hubs/webhook`.

Kiểm tra kết nối:

```bash
curl https://message-hub.example.com/api/health
# {"status":"ok","version":"1.0.0"}
```

Mọi lời gọi API quản trị dùng header:

```
Authorization: Bearer API_KEY
```

---

## 3. Bước 1 — Tạo channel

```bash
curl -X POST https://message-hub.example.com/api/v1/channels \
  -H "Authorization: Bearer API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nha khoa Hoa Sen",
    "ref": "workspace_123",
    "webhookUrl": "https://api.example.com/plugins/message-hubs/webhook",
    "allowedOrigins": ["https://hoasen.vn", "https://*.hoasen.vn"],
    "settings": {
      "theme": { "color": "#0f766e" },
      "locales": ["vi", "en"],
      "defaultLocale": "vi",
      "content": { "brandName": { "vi": "Nha khoa Hoa Sen", "en": "Hoa Sen Dental" } }
    }
  }'
```

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `name` | Có | Tên channel, tối đa 100 ký tự |
| `ref` | Không | Khóa phía bạn (id workspace). Có trong mọi webhook và lọc được khi liệt kê |
| `webhookUrl` | Không | Nơi nhận sự kiện. Bỏ trống thì không gửi webhook |
| `allowedOrigins` | Không | Các website được phép nhúng widget. Bỏ trống là cho phép mọi nơi |
| `settings` | Không | Cấu hình giao diện và nội dung, xem [mục 7](#7-bước-5--tùy-biến-giao-diện-và-nội-dung). Trường nào thiếu sẽ lấy mặc định |

Kết quả (201):

```json
{
  "id": "ch_-o-CTTu03eGO0NivE8YUrQ",
  "name": "Nha khoa Hoa Sen",
  "ref": "workspace_123",
  "webhookUrl": "https://api.example.com/plugins/message-hubs/webhook",
  "webhookSecret": "whsec_…",
  "allowedOrigins": ["https://hoasen.vn", "https://*.hoasen.vn"],
  "settings": { "…": "cấu hình đầy đủ, đã điền mặc định" },
  "embedPath": "/embed/ch_-o-CTTu03eGO0NivE8YUrQ.js",
  "connectedAt": null,
  "createdAt": "2026-10-07T02:54:27.900Z",
  "updatedAt": "2026-10-07T02:54:27.900Z"
}
```

Lưu lại hai giá trị:

- **`id`** để dựng thẻ script và gọi API.
- **`webhookSecret`** để kiểm chữ ký webhook. Giữ bí mật, chỉ lưu phía server.

---

## 4. Bước 2 — Nhúng widget vào website

### 4.1 Thẻ script

Dán vào trang, ở bất kỳ đâu trong `<head>` hoặc `<body>`:

```html
<script src="https://message-hub.example.com/embed/ch_-o-CTTu03eGO0NivE8YUrQ.js" async></script>
```

Cách này dùng được với HTML thuần, WordPress, Shopify, Google Tag Manager và mọi framework. Nút chat hiện ở góc màn hình; khung chat chỉ được tải khi người dùng bấm vào nút.

Thuộc tính tùy chọn trên thẻ script:

| Thuộc tính | Tác dụng |
|---|---|
| `data-locale="vi"` | Ép ngôn ngữ, bỏ qua việc tự nhận |
| `data-auto-init="false"` | Không tự khởi tạo; bạn tự gọi `MessageHub.init()` khi cần |

### 4.2 Dùng trong React / Next.js

Không có gói npm. Tạo một component nhỏ chèn chính thẻ script ở trên:

```tsx
'use client';
import { useEffect } from 'react';

declare global {
  interface Window {
    MessageHub?: {
      open(): void;
      close(): void;
      toggle(): void;
      setLocale(code: string | null): void;
      identify(profile: Record<string, string | number>): void;
      on(event: string, fn: (payload?: unknown) => void): () => void;
      destroy(): void;
    };
  }
}

export function MessageHubWidget({ host, channelId, locale }: { host: string; channelId: string; locale?: string }) {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = `${host}/embed/${channelId}.js`;
    script.async = true;
    document.head.appendChild(script);
    return () => {
      window.MessageHub?.destroy();
      script.remove();
    };
  }, [host, channelId]);

  // Đổi ngôn ngữ không cần gỡ và chèn lại script.
  useEffect(() => {
    window.MessageHub?.setLocale(locale ?? null);
  }, [locale]);

  return null;
}
```

```tsx
<MessageHubWidget host="https://message-hub.example.com" channelId="ch_…" locale={i18n.language} />
```

Component an toàn với render phía server (chỉ chạy trong `useEffect`) và với React StrictMode (loader khởi tạo lại được nhiều lần).

### 4.3 Điều khiển widget: `window.MessageHub`

| Hàm | Tác dụng |
|---|---|
| `open()`, `close()`, `toggle()` | Mở, đóng khung chat |
| `setLocale('en')` | Đổi ngôn ngữ ngay lập tức. Truyền `null` để quay về tự nhận |
| `identify({ name, email, phone })` | Điền sẵn thông tin visitor. Xem ghi chú bên dưới |
| `on(event, fn)` | Lắng nghe sự kiện; trả về hàm để hủy |
| `init(options)`, `destroy()` | Khởi tạo và gỡ widget |

Sự kiện của `on()`:

| Sự kiện | Khi nào | Dữ liệu |
|---|---|---|
| `ready` | Khung chat đã tải xong | — |
| `open`, `close` | Khung chat mở, đóng | — |
| `message` | Có tin trả lời mới | `{ id, text, createdAt }` |
| `unread` | Số tin chưa đọc thay đổi | số nguyên |

> **Visitor quay lại:** nếu `localStorage` của trang đã có token của channel (người đã chat), loader tạo iframe **ẩn** ngay lúc `init`. Nhờ đó `message` và `unread` hoạt động, và badge hiện cả với tin trả lời đến lúc người dùng vắng mặt, mà không cần mở chat. Iframe ẩn không cướp focus, không phát âm thanh trước khi người dùng tương tác với khung chat và không đánh dấu tin là đã đọc (mốc đã đọc chỉ được ghi khi chat đang mở, lưu ở key `mh:read:<channelId>`). Người chưa từng chat vẫn không có iframe và không ghi gì vào DB. Mỗi tab đang mở giữ một kết nối SSE (tối đa 5 mỗi visitor). Loader được cache tối đa 120 giây.

Ví dụ:

```js
// Người dùng đã đăng nhập ở website: truyền thông tin để bỏ qua form hỏi tên
MessageHub.identify({ name: 'Nguyễn Lan', email: 'lan@example.com', customerId: 'KH001' });

// Tự làm nút mở chat (đặt settings.launcher.hidden = true để ẩn nút mặc định)
document.querySelector('#help').addEventListener('click', () => MessageHub.open());

// Đếm tin chưa đọc lên icon của bạn
MessageHub.on('unread', (count) => { badge.textContent = count || ''; });
```

> **`identify()` không xác minh danh tính.** Dữ liệu đến từ trình duyệt nên người dùng tự sửa được. Dùng nó để hiển thị và điền sẵn, không dùng để cấp quyền hay tin là "khách hàng KH001 thật".

Giới hạn của `profile`: tối đa 20 khóa; tên khóa gồm chữ, số và `_`, bắt đầu bằng chữ; giá trị là chuỗi (tối đa 500 ký tự) hoặc số.

### 4.4 Ngôn ngữ

Widget chọn ngôn ngữ theo thứ tự sau, lấy cái đầu tiên có trong `settings.locales` của channel:

1. `data-locale` trên thẻ script, hoặc `MessageHub.setLocale()`.
2. Thuộc tính `lang` của thẻ `<html>` trên trang khách.
3. Ngôn ngữ trình duyệt.
4. `settings.defaultLocale`.

Mã vùng được rút gọn tự động (`vi-VN` thành `vi`). Ngôn ngữ đã chọn được lưu vào `visitor.locale` và có trong mọi webhook, để bạn trả lời đúng ngôn ngữ.

Hỗ trợ 8 ngôn ngữ:

| Mã locale | Ngôn ngữ |
|---|---|
| `en` | Tiếng Anh |
| `vi` | Tiếng Việt |
| `ko` | Tiếng Hàn |
| `zh` | Tiếng Trung (giản thể) |
| `ja` | Tiếng Nhật |
| `th` | Tiếng Thái |
| `fr` | Tiếng Pháp |
| `ru` | Tiếng Nga |

Danh sách locale và bản dịch giao diện lấy từ `GET /api/v1/meta` (`locales`, `messages`), xem [mục 7.5](#75-tự-dựng-trang-cài-đặt-bằng-meta).

Channel mặc định chỉ bật `["en", "vi"]`, với `defaultLocale: "en"`; channel đã lưu không tự bật thêm ngôn ngữ. Bật những ngôn ngữ cần dùng qua `settings.locales` khi tạo hoặc `PATCH` channel, ví dụ:

```json
{
  "settings": {
    "locales": ["vi", "en", "ko", "zh", "ja", "th", "fr", "ru"],
    "defaultLocale": "vi"
  }
}
```

Sau khi bật, có thể dùng `data-locale="ja"`, `MessageHub.setLocale('ja')` hoặc để tự nhận từ trang/trình duyệt. Các mã vùng như `ko-KR`, `zh-CN`, `ja-JP`, `th-TH`, `fr-FR`, `ru-RU` được rút gọn về locale tương ứng. Chuỗi nội dung (`LocalizedText`) và override giao diện có thể khai báo theo các locale này; nội dung riêng của channel không được dịch tự động. Iframe chỉ tải catalog đang dùng và English làm dự phòng.

### 4.5 Nếu website khách có Content-Security-Policy

Chỉ cần thêm hai chỉ thị:

```
script-src https://message-hub.example.com;
frame-src  https://message-hub.example.com;
```

Không cần `connect-src` hay `style-src 'unsafe-inline'`. Nếu bạn đặt `settings.launcher.icon` là ảnh từ một domain khác thì thêm domain đó vào `img-src`.

Hai trường hợp không hỗ trợ: trang bật `Cross-Origin-Embedder-Policy: require-corp`, và trang bắt buộc Trusted Types (khi đó hãy viết thẻ script sẵn trong HTML thay vì chèn bằng mã).

---

## 5. Bước 3 — Nhận webhook

Message Hub gửi `POST` tới `webhookUrl` của channel cho mỗi sự kiện.

### 5.1 Request

```http
POST /plugins/message-hubs/webhook HTTP/1.1
Content-Type: application/json
User-Agent: MessageHub-Webhook/2
X-MessageHub-Event: message.created
X-MessageHub-Delivery: 1024
X-MessageHub-Signature: t=1791341668,v1=84e4…
```

```json
{
  "id": 1024,
  "event": "message.created",
  "createdAt": "2026-10-07T08:00:00.000Z",
  "channel": { "id": "ch_…", "ref": "workspace_123" },
  "data": {
    "message": {
      "id": "msg_…",
      "direction": "inbound",
      "text": "Cho mình hỏi giá niềng răng",
      "attachments": [
        { "fileId": "file_…", "name": "rang.png", "mime": "image/png", "size": 48213, "url": "https://files.message-hub.example.com/files/file_…" }
      ],
      "sender": null,
      "context": { "url": "https://hoasen.vn/bang-gia", "title": "Bảng giá", "referrer": "https://google.com/" },
      "createdAt": "2026-10-07T08:00:00.000Z"
    },
    "visitor": { "id": "vis_…", "locale": "vi", "profile": { "name": "Lan", "phone": "0901234567" } }
  }
}
```

Payload đã có sẵn `channel.ref` và `visitor.profile`, nên bạn **không cần gọi ngược** API để biết tin thuộc workspace nào hay visitor tên gì.

### 5.2 Các sự kiện

| `event` | Khi nào | `data` |
|---|---|---|
| `message.created` | Mỗi tin nhắn mới, cả `inbound` lẫn `outbound` | `message`, `visitor` |
| `visitor.created` | Visitor bấm bắt đầu chat | `visitor` |
| `visitor.updated` | `profile` hoặc `locale` của visitor thay đổi | `visitor` |
| `channel.connected` | Lần đầu tiên thẻ script của channel được tải trên một trang | `connectedAt` |

Ghi chú về `message.created`:

- Tin `outbound` (do chính bạn gửi qua API) **cũng được gửi lại** qua webhook. Dùng `direction` để phân biệt, và bỏ qua nếu bạn đã ghi nhận tin đó lúc gửi.
- `context` (trang visitor đang xem) chỉ có ở tin `inbound`.
- `sender` chỉ có ở tin `outbound`.

### 5.3 Kiểm chữ ký

Luôn kiểm chữ ký trước khi xử lý. Header có dạng `t=<unix giây>,v1=<hex>`, trong đó:

```
v1 = HMAC-SHA256(webhookSecret, "<t>.<body thô>")
```

Hai điểm dễ sai:

- Phải tính trên **body thô**, đúng từng byte nhận được. Nếu framework đã parse JSON rồi stringify lại thì chữ ký sẽ không khớp.
- Từ chối khi `t` lệch quá 5 phút so với giờ hiện tại, để chống gửi lại request cũ.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyMessageHub(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(String(header ?? '').split(',').map((p) => p.trim().split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

**Express:**

```js
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  const event = JSON.parse(raw);
  const secret = lookupSecret(event.channel.id);          // webhookSecret bạn đã lưu ở Bước 1
  if (!verifyMessageHub(secret, req.get('x-messagehub-signature'), raw)) return res.sendStatus(401);
  res.sendStatus(200);                                     // trả lời trước, xử lý sau
  void handle(event);
});
```

**NestJS:** bật body thô khi khởi tạo app, rồi đọc `req.rawBody`:

```ts
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });

// controller
@Post('webhook')
@HttpCode(200)
async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-messagehub-signature') signature: string) {
  const raw = req.rawBody!.toString('utf8');
  const event = JSON.parse(raw);
  const secret = await this.service.secretFor(event.channel.id);
  if (!verifyMessageHub(secret, signature, raw)) throw new UnauthorizedException();
  await this.service.enqueue(event);
}
```

Mỗi channel có secret riêng. Tìm secret theo `channel.id` trong payload (payload chưa được tin cậy ở bước này, nhưng chữ ký sai secret thì vẫn bị từ chối).

### 5.4 Trả lời, thử lại và trùng lặp

| Quy tắc | Chi tiết |
|---|---|
| Thành công | Trả mã `2xx` trong vòng **10 giây**. Nên trả lời ngay rồi xử lý nền |
| Thất bại | Mọi mã khác, timeout, lỗi mạng. Mã `3xx` cũng là lỗi: Message Hub không đi theo chuyển hướng |
| Thử lại | Tối đa 6 lần gửi. Khoảng chờ: 10 giây, 1 phút, 5 phút, 30 phút, 2 giờ |
| Hết lượt | Chuyển sang trạng thái `failed`. Xem và gửi lại bằng API ở [mục 8.5](#85-theo-dõi-webhook) |
| Thứ tự | Trong một channel, sự kiện đến đúng thứ tự. Một sự kiện đang chờ thử lại sẽ giữ các sự kiện sau nó |
| Trùng lặp | Một sự kiện **có thể đến hơn một lần**. Khử trùng bằng `X-MessageHub-Delivery` (hoặc `data.message.id`) |

---

## 6. Bước 4 — Trả lời visitor

### 6.1 Gửi tin

```bash
curl -X POST https://message-hub.example.com/api/v1/visitors/vis_…/messages \
  -H "Authorization: Bearer API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Chào Lan, niềng răng bên mình từ 25 triệu. Xem thêm: https://hoasen.vn/nieng-rang",
    "sender": { "id": "agent_7", "name": "Bác sĩ Minh", "avatar": "https://cdn.example.com/a/7.png" }
  }'
```

`vis_…` lấy từ `data.visitor.id` trong webhook. Tin hiện ngay trong khung chat nếu visitor đang mở trang; nếu không, họ thấy khi quay lại.

| Trường | Ý nghĩa |
|---|---|
| `text` | Tối đa 4000 ký tự. Là **văn bản thuần**: xuống dòng được giữ, link `http(s)` tự thành liên kết. Markdown và HTML hiển thị nguyên dạng chữ |
| `sender` | Tùy chọn. `name` và `avatar` hiện cạnh bong bóng tin; `id` để bạn tự đối chiếu |
| `attachments` | Tùy chọn, tối đa 10. Xem mục 6.3 |

Phải có `text` hoặc ít nhất một `attachments`.

### 6.2 Báo "đang trả lời"

Khi nhân viên đang gõ, hoặc AI agent cần vài giây để soạn câu trả lời:

```bash
curl -X POST https://message-hub.example.com/api/v1/visitors/vis_…/typing \
  -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" \
  -d '{ "sender": { "name": "Bác sĩ Minh" } }'
```

Khung chat hiện "Bác sĩ Minh đang soạn tin…" trong tối đa 10 giây, hoặc tới khi tin trả lời đến. Gọi lại nếu cần giữ lâu hơn. Tín hiệu này không được lưu.

### 6.3 Gửi kèm file

Tải file lên trước, rồi dùng `id` nhận được:

```bash
curl -X POST https://message-hub.example.com/api/v1/files \
  -H "Authorization: Bearer API_KEY" \
  -F "channelId=ch_…" \
  -F "file=@bao-gia.pdf"
# {"id":"file_…","name":"bao-gia.pdf","mime":"application/pdf","size":120394,"url":"https://files.message-hub.example.com/files/file_…"}

curl -X POST https://message-hub.example.com/api/v1/visitors/vis_…/messages \
  -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" \
  -d '{ "text": "Gửi bạn báo giá", "attachments": [{ "fileId": "file_…" }] }'
```

- Loại file được nhận: `png`, `jpg`, `gif`, `webp`, `mp4`, `webm`, `mp3`, `pdf`, `txt`, `csv`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`. Nội dung file phải khớp với đuôi.
- Dung lượng tối đa theo cấu hình `MAX_UPLOAD_MB` của Message Hub (mặc định 10 MB).
- File tải lên mà không được gắn vào tin nào sẽ bị xóa sau 24 giờ.
- File phải thuộc đúng channel của visitor.

---

## 7. Bước 5 — Tùy biến giao diện và nội dung

Mọi tùy biến nằm trong `settings` của channel. Sửa bằng `PATCH`, **chỉ gửi trường muốn đổi**:

```bash
curl -X PATCH https://message-hub.example.com/api/v1/channels/ch_… \
  -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" \
  -d '{ "settings": { "theme": { "color": "#0f766e", "radius": "lg" } } }'
```

Quy tắc của `PATCH`:

- Các object được gộp theo từng khóa; phần không gửi giữ nguyên.
- Mảng (`locales`, `starters`, `preChat.fields`) bị **thay toàn bộ**.
- Gửi `null` để xóa một giá trị tùy chọn, ví dụ `{"settings":{"theme":{"logo":null}}}`.
- Trường lạ hoặc sai kiểu trả lỗi 400 kèm tên trường.
- Thay đổi về nút chat có hiệu lực trên website khách sau tối đa 2 phút (thời gian cache của thẻ script).

### 7.1 Các nhóm cấu hình

| Nhóm | Trường | Giá trị | Mặc định |
|---|---|---|---|
| `theme` | `color` | Mã hex 6 chữ số | `#1f2937` |
| | `colorScheme` | `light`, `dark`, `auto` (theo thiết bị) | `auto` |
| | `radius` | `none`, `sm`, `md`, `lg` | `md` |
| | `fontFamily` | Tên font có sẵn trên máy visitor (không tải webfont) | Font hệ thống |
| | `logo` | URL ảnh `http(s)` | — |
| `launcher` | `position` | `left`, `right` | `right` |
| | `offset` | `{ "x": 0–400, "y": 0–400 }` tính bằng px từ góc | `{ x: 20, y: 20 }` |
| | `icon` | URL ảnh thay cho icon mặc định | — |
| | `label` | Chữ cạnh icon, theo ngôn ngữ | — |
| | `hidden` | `true` để ẩn nút, tự gọi `MessageHub.open()` | `false` |
| | `zIndex` | Số nguyên | `2147483000` |
| `window` | `width`, `height` | 280–800, 360–1000 (px, trên desktop) | `380`, `640` |
| (gốc) | `locales` | Các ngôn ngữ bật cho channel | `["en", "vi"]` |
| | `defaultLocale` | Phải nằm trong `locales` | `en` |
| `content` | `brandName`, `welcomeTitle`, `welcomeSubtitle` | Chữ theo ngôn ngữ | — |
| | `greeting` | Bong bóng chào ở đầu hội thoại (không lưu thành tin nhắn) | — |
| | `starters` | Tối đa 6 câu hỏi gợi ý, bấm là gửi | — |
| | `overrides` | Thay chuỗi giao diện, xem mục 7.3 | — |
| `preChat` | `mode` | `off`, `optional`, `required` | `off` |
| | `fields` | Tối đa 10 trường, xem mục 7.4 | `[]` |
| `features` | `attachments` | Cho visitor gửi file | `true` |
| | `sound` | Âm báo tin mới | `true` |

Trên màn hình hẹp (điện thoại), khung chat luôn chiếm toàn màn hình.

### 7.2 Nội dung theo ngôn ngữ

Mọi chuỗi nội dung là một object ánh xạ mã ngôn ngữ sang chữ:

```json
{
  "settings": {
    "content": {
      "brandName":       { "vi": "Nha khoa Hoa Sen", "en": "Hoa Sen Dental" },
      "welcomeTitle":    { "vi": "Xin chào 👋", "en": "Hi there 👋" },
      "welcomeSubtitle": { "vi": "Bạn cần tư vấn gì ạ?", "en": "How can we help?" },
      "greeting":        { "vi": "Chào bạn, mình là trợ lý của Hoa Sen.", "en": "Hello, I'm Hoa Sen's assistant." },
      "starters": [
        { "vi": "Bảng giá niềng răng", "en": "Braces pricing" },
        { "vi": "Đặt lịch khám", "en": "Book an appointment" }
      ]
    },
    "launcher": { "label": { "vi": "Chat với chúng tôi", "en": "Chat with us" } }
  }
}
```

Thiếu bản dịch cho ngôn ngữ đang dùng thì widget lấy bản của `defaultLocale`, rồi tới chuỗi mặc định có sẵn. Mỗi chuỗi tối đa 500 ký tự.

### 7.3 Đổi câu chữ của giao diện

Mọi chuỗi có sẵn trong giao diện (nút, placeholder, thông báo) đều thay được theo từng channel và từng ngôn ngữ:

```json
{
  "settings": {
    "content": {
      "overrides": {
        "vi": {
          "composer.placeholder": "Bạn cần hỗ trợ gì ạ?",
          "welcome.start": "Nhắn tin ngay",
          "chat.agent": "Tư vấn viên"
        }
      }
    }
  }
}
```

Danh sách đầy đủ các khóa và chuỗi mặc định lấy từ `GET /api/v1/meta` (mục 7.5). Khóa không tồn tại bị từ chối khi lưu. Một số khóa hay dùng:

| Khóa | Mặc định (vi) |
|---|---|
| `welcome.title` | Xin chào! |
| `welcome.subtitle` | Hãy nhắn tin cho chúng tôi, chúng tôi sẽ trả lời ngay tại đây. |
| `welcome.start` | Bắt đầu chat |
| `header.title` | Hỗ trợ |
| `composer.placeholder` | Nhập tin nhắn… |
| `composer.send` | Gửi |
| `chat.agent` | Hỗ trợ |
| `chat.typingAnonymous` | Đang trả lời… |
| `launcher.open` | Mở chat |

### 7.4 Form trước khi chat

```json
{
  "settings": {
    "preChat": {
      "mode": "required",
      "fields": [
        { "key": "name",  "type": "name",  "required": true },
        { "key": "phone", "type": "phone", "required": true,
          "label": { "vi": "Số điện thoại liên hệ", "en": "Contact phone" } },
        { "key": "note",  "type": "text",
          "label": { "vi": "Bạn quan tâm dịch vụ nào?", "en": "Which service?" },
          "placeholder": { "vi": "Niềng răng, tẩy trắng…", "en": "Braces, whitening…" } }
      ]
    }
  }
}
```

| `mode` | Hành vi |
|---|---|
| `off` | Không hỏi gì, vào chat ngay |
| `optional` | Hiện form, có nút bỏ qua |
| `required` | Phải điền các trường `required` mới vào chat |

`type` nhận `text`, `number`, `name`, `phone`, `email`. Không đặt `label` thì widget dùng nhãn mặc định theo `type`. Giá trị người dùng nhập được lưu vào `visitor.profile[key]` và có trong webhook `visitor.created`.

Nếu website đã gọi `MessageHub.identify()` với đủ các trường bắt buộc thì form được bỏ qua.

### 7.5 Tự dựng trang cài đặt bằng `meta`

`GET /api/v1/meta` mô tả mọi thứ cần để dựng giao diện cài đặt phía bạn:

```json
{
  "version": "1.0.0",
  "apiVersion": "v1",
  "settings": {
    "jsonSchema": { "…": "JSON Schema của settings" },
    "defaults":   { "…": "giá trị mặc định đầy đủ" }
  },
  "locales": [
    { "code": "en", "name": "English", "dir": "ltr" },
    { "code": "vi", "name": "Tiếng Việt", "dir": "ltr" },
    { "code": "ko", "name": "한국어", "dir": "ltr" },
    { "code": "zh", "name": "简体中文", "dir": "ltr" },
    { "code": "ja", "name": "日本語", "dir": "ltr" },
    { "code": "th", "name": "ไทย", "dir": "ltr" },
    { "code": "fr", "name": "Français", "dir": "ltr" },
    { "code": "ru", "name": "Русский", "dir": "ltr" }
  ],
  "messages": {
    "en": { "composer.send": "Send", "…": "…" },
    "vi": { "composer.send": "Gửi", "…": "…" },
    "ko": { "composer.send": "보내기", "…": "…" },
    "zh": { "composer.send": "发送", "…": "…" },
    "ja": { "composer.send": "送信", "…": "…" },
    "th": { "composer.send": "ส่ง", "…": "…" },
    "fr": { "composer.send": "Envoyer", "…": "…" },
    "ru": { "composer.send": "Отправить", "…": "…" }
  }
}
```

| Dùng để | Lấy từ |
|---|---|
| Sinh form cài đặt và kiểm tra dữ liệu nhập | `settings.jsonSchema`, `settings.defaults` |
| Danh sách ngôn ngữ cho người dùng chọn | `locales` |
| Màn hình "sửa câu chữ": hiện chuỗi mặc định, lưu thay đổi vào `content.overrides` | `messages` |

Khi Message Hub thêm tùy chọn hay ngôn ngữ mới, giao diện dựng từ `meta` tự có theo.

Lưu ý: JSON Schema chưa mô tả các ràng buộc chéo (ví dụ `defaultLocale` phải nằm trong `locales`); các ràng buộc này được kiểm khi lưu và trả lỗi 400.

### 7.6 Xem trước trực tiếp

Đặt một iframe cạnh form cài đặt:

```html
<iframe id="mh-preview" src="https://message-hub.example.com/w/ch_…?preview=1" style="width:380px;height:640px;border:0"></iframe>
```

Mỗi khi form thay đổi, gửi cấu hình **chưa lưu** vào iframe:

```js
const frame = document.getElementById('mh-preview');

function updatePreview(formValues, locale, screen) {
  frame.contentWindow.postMessage(
    { type: 'mh:preview', settings: formValues, locale, screen },   // screen: 'welcome' | 'prechat' | 'chat'
    'https://message-hub.example.com',
  );
}

// Iframe báo đã sẵn sàng bằng mh:hello; gửi cấu hình lần đầu tại đây.
window.addEventListener('message', (e) => {
  if (e.origin === 'https://message-hub.example.com' && e.data?.type === 'mh:hello') updatePreview(currentValues, 'vi', 'welcome');
});
```

Chế độ xem trước không tạo visitor, không gửi tin, và nhúng được ở mọi website (kể cả khi channel có `allowedOrigins`). `settings` gửi vào có thể thiếu trường; phần thiếu lấy mặc định.

---

## 8. Tham chiếu API

### 8.1 Quy ước chung

- **Xác thực:** `Authorization: Bearer API_KEY`. Sai hoặc thiếu trả 401.
- **Phạm vi:** một key chỉ thấy dữ liệu của channel do nó tạo. Truy cập channel của key khác trả 404.
- **Thời gian:** chuỗi ISO 8601, múi giờ UTC.
- **Phân trang danh sách:** `?limit=` (1–100, mặc định 50) và `?offset=`. Kết quả có dạng `{ "data": [...], "hasMore": true }`.
- **Body:** JSON. Trường không được khai báo sẽ bị từ chối (400).

Lỗi luôn có dạng:

```json
{ "error": { "code": "VISITOR_NOT_FOUND", "message": "Visitor not found" } }
```

| HTTP | `code` thường gặp |
|---|---|
| 400 | `VALIDATION_ERROR`, `FILE_NOT_FOUND`, `INVALID_MULTIPART` |
| 401 | `UNAUTHORIZED` |
| 403 | `ATTACHMENTS_DISABLED` |
| 404 | `CHANNEL_NOT_FOUND`, `VISITOR_NOT_FOUND`, `DELIVERY_NOT_FOUND` |
| 413 | `PAYLOAD_TOO_LARGE`, `FILE_TOO_LARGE` |
| 415 | `FILE_TYPE_NOT_ALLOWED` |
| 429 | `RATE_LIMITED` (kèm header `Retry-After`) |
| 500 | `INTERNAL` |

### 8.2 Channel

| Route | Mô tả |
|---|---|
| `GET /api/v1/channels?ref=` | Liệt kê, mới tạo trước. Lọc theo `ref` |
| `POST /api/v1/channels` | Tạo. Body: `name`, `ref?`, `webhookUrl?`, `allowedOrigins?`, `settings?` |
| `GET /api/v1/channels/{id}` | Chi tiết |
| `PATCH /api/v1/channels/{id}` | Sửa từng phần. Gửi `"ref": null` hoặc `"webhookUrl": null` để xóa |
| `PUT /api/v1/channels/{id}/webhook` | Chỉ thay webhook URL. Body: `{ "webhookUrl": "https://…" }`; gửi `null` để tắt |
| `DELETE /api/v1/channels/{id}` | Xóa channel cùng toàn bộ visitor, tin nhắn và file (204) |
| `POST /api/v1/channels/{id}/rotate-secret` | Sinh `webhookSecret` mới. Secret cũ hết hiệu lực ngay |

`allowedOrigins` nhận origin đầy đủ, không có đường dẫn: `https://example.com`, `http://localhost:3000`, hoặc dạng mọi tên miền con `https://*.example.com`. Tối đa 50 mục.

Endpoint `PUT …/webhook` không đổi `webhookSecret`. Các delivery còn `pending` sẽ dùng URL hiện tại của channel ở lần gửi tiếp theo.

`connectedAt` khác `null` nghĩa là thẻ script của channel đã được tải ít nhất một lần.

### 8.3 Visitor và hội thoại

| Route | Mô tả |
|---|---|
| `GET /api/v1/channels/{id}/visitors` | Liệt kê visitor, hoạt động gần nhất trước |
| `GET /api/v1/visitors/{id}` | `{ id, channelId, locale, profile, userAgent, origin, lastSeenAt, createdAt }` |
| `GET /api/v1/visitors/{id}/messages?before=&limit=` | Lịch sử hội thoại |
| `POST /api/v1/visitors/{id}/messages` | Trả lời visitor (201) |
| `DELETE /api/v1/visitors/{id}/messages` | Xóa toàn bộ tin của hội thoại (204) |
| `POST /api/v1/visitors/{id}/typing` | Báo đang trả lời |

Lịch sử hội thoại phân trang theo con trỏ, khác với các danh sách còn lại:

- `limit` từ 1 đến 50, mặc định 50. Không có `before` thì trả trang mới nhất.
- Trong một trang, tin xếp từ cũ đến mới.
- Để lấy trang cũ hơn, truyền `before` bằng `seq` của tin đầu tiên trong trang hiện tại.

Một tin nhắn:

```json
{
  "id": "msg_…", "seq": 42, "direction": "outbound", "text": "…",
  "attachments": [{ "fileId": "file_…", "name": "a.pdf", "mime": "application/pdf", "size": 1234, "url": "/files/file_…" }],
  "sender": { "id": "agent_7", "name": "Bác sĩ Minh", "avatar": "https://…" },
  "context": null, "clientMessageId": null, "createdAt": "2026-10-07T08:00:05.000Z"
}
```

### 8.4 File

| Route | Mô tả |
|---|---|
| `POST /api/v1/files` | `multipart/form-data` với `channelId` và `file`. Trả `{ id, name, mime, size, url }` (201) |
| `GET /files/{id}` | Tải file. Không cần key; ai có đường dẫn đều tải được |

Ảnh, âm thanh và video hiển thị trực tiếp trong trình duyệt; các loại khác luôn được tải về.

Trong **response của API**, `url` là đường dẫn tương đối (`/files/…`) trừ khi Message Hub đặt `FILES_BASE_URL`. Trong **payload webhook**, `url` là địa chỉ đầy đủ khi Message Hub đặt `PUBLIC_URL` hoặc `FILES_BASE_URL`.

Production dùng `PUBLIC_URL=https://message-hub.example.com` và `FILES_BASE_URL=https://files.message-hub.example.com`, nên URL tải file trong cả API và webhook có dạng `https://files.message-hub.example.com/files/file_…`.

### 8.5 Theo dõi webhook

| Route | Mô tả |
|---|---|
| `GET /api/v1/deliveries?status=&channelId=` | Liệt kê các lần gửi, mới nhất trước. `status`: `pending`, `delivered`, `failed` |
| `POST /api/v1/deliveries/{id}/retry` | Đưa một lần gửi trở lại hàng đợi, gửi ngay |

```json
{
  "id": 1024, "channelId": "ch_…", "event": "message.created", "status": "failed",
  "attempts": 6, "lastStatus": 503, "lastError": "HTTP 503",
  "nextAttemptAt": "…", "createdAt": "…", "deliveredAt": null
}
```

Các lần gửi thành công được giữ 7 ngày rồi tự xóa.

### 8.6 Giới hạn

| Giới hạn | Giá trị |
|---|---|
| Độ dài `text` | 4000 ký tự |
| Số file đính kèm mỗi tin | 10 |
| Dung lượng file | `MAX_UPLOAD_MB`, mặc định 10 MB |
| Tải file qua API quản trị | 60 lần mỗi phút cho mỗi key |
| Visitor gửi tin | 20 tin mỗi phút |
| Visitor tải file | 10 lần mỗi phút |
| Tạo hội thoại mới | 20 lần mỗi phút cho mỗi địa chỉ IP |

---

## 9. Widget không hiện: cách kiểm tra

Trình duyệt không báo lỗi cho người dùng khi widget bị chặn, nên hãy kiểm theo thứ tự:

1. **Console của trình duyệt.** Loader ghi cảnh báo bắt đầu bằng `[MessageHub]` khi không xác định được nơi tải, hoặc khi khung chat không khởi động sau 15 giây.
2. **Tab Network.** `/embed/ch_….js` phải trả 200. Mã 404 nghĩa là sai id channel.
3. **CSP của trang.** Console có dòng "Refused to load the script" hoặc "Refused to frame": thêm hai chỉ thị ở [mục 4.5](#45-nếu-website-khách-có-content-security-policy).
4. **Khung chat trắng.** Hai nguyên nhân thường gặp:
   - Tên miền của trang không nằm trong `allowedOrigins` của channel. Console báo vi phạm `frame-ancestors`.
   - Reverse proxy hoặc CDN đứng trước Message Hub tự thêm header `X-Frame-Options`. Cần bỏ header này cho đường dẫn `/w/*`.
5. **Trang HTTPS nhưng script dùng HTTP.** Trình duyệt chặn nội dung hỗn hợp. Production phải dùng `https://message-hub.example.com`.
6. **Trình chặn quảng cáo.** Thử tắt để loại trừ.
7. **Thay đổi cấu hình chưa có hiệu lực.** Thẻ script được cache 2 phút.

Để thử nhanh mà không cần website: mở `https://message-hub.example.com/demo.html?channel=ch_…`, hoặc mở thẳng khung chat tại `https://message-hub.example.com/w/ch_…`.

---

## 10. Lưu ý vận hành

Dành cho người triển khai Message Hub, vì chúng ảnh hưởng trực tiếp tới tích hợp:

- **Đặt host production:** `PUBLIC_URL=https://message-hub.example.com` và `FILES_BASE_URL=https://files.message-hub.example.com`, để URL file trong API và webhook dùng hostname riêng. Cả hai domain cần HTTPS và trỏ vào cùng app, cổng 4200.
- **Reverse proxy** cần: nối địa chỉ client vào **cuối** `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) và đặt `TRUSTED_PROXIES` bằng số proxy (mặc định `1`; `0` = bỏ qua header). Giới hạn tần suất theo IP chỉ tin hop do proxy của bạn ghi, nên header giả của client không qua mặt được; khi không xác định được địa chỉ thì không giới hạn theo IP và chỉ còn trần chung 300 session/phút; không đệm (buffer) đường dẫn `/api/widget/stream`; không thêm `X-Frame-Options` cho `/w/*`.
- **Chỉ chạy một instance.** Khi triển khai bản mới, dừng bản cũ rồi mới chạy bản mới. Trong vài giây gián đoạn, khung chat tự kết nối lại và nhận bù tin bị lỡ.
- **Xoay API key:** thêm key mới cùng tên vào `API_KEYS`, đổi key phía dự án chính, rồi xóa key cũ.
- **Xoay webhook secret:** gọi `rotate-secret`, cập nhật secret phía bạn ngay. Các webhook gửi trong khoảng giữa sẽ sai chữ ký và được thử lại theo lịch.
- **Thời gian lưu hội thoại:** mặc định giữ mãi. Nếu Message Hub đặt `MESSAGE_RETENTION_DAYS`, visitor không hoạt động quá số ngày đó bị xóa cùng tin nhắn. Dự án chính nên tự lưu bản sao hội thoại từ webhook.
