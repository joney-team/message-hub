---
feature: customization
title: Tùy biến cho dự án chính
domain: message-hub
category: Integration
status: stable
version: 1.0.0
owner: maintainers
last_verified: 2026-10-07
modules: [src/settings, src/widget/theme.ts, src/widget/components/PreChat.tsx, src/app/api/v1/meta, src/loader]
entities: [channels]
routes: [GET /api/v1/meta, PATCH /api/v1/channels/[id], "GET /w/[channelId]?preview=1"]
related_plans: []
related_features: [channels, i18n, widget-sdk]
---

# Feature Spec: Tùy biến cho dự án chính

## A. Sản phẩm

### Tổng quan

Ứng dụng chính tùy biến được giao diện và nội dung widget mà không cần biết chi tiết bên trong Message Hub: lấy schema từ `meta`, dựng form, xem trước trực tiếp trong iframe, rồi `PATCH` từng phần.

### Quyết định sản phẩm

- Không cho CSS tùy ý hay HTML tùy ý: mọi tùy biến là giá trị có kiểu, thành biến CSS.
- Không có giờ làm việc/offline, markdown, định danh có chữ ký trong 2.0.0 (cố ý).

### User Stories

**US-1 — Tự dựng form:** Là lập trình viên ứng dụng chính, tôi muốn lấy JSON Schema của settings để form tự có tùy chọn mới.

**US-2 — Xem trước:** Là chủ workspace, tôi muốn thấy thay đổi ngay khi sửa, trước khi lưu.

**US-3 — Thương hiệu:** Là chủ workspace, tôi muốn đổi màu, bo góc, font, logo, sáng/tối, vị trí và nhãn nút.

**US-4 — Nội dung:** Là chủ workspace, tôi muốn đặt lời chào, bong bóng chào đầu hội thoại và câu hỏi gợi ý theo từng ngôn ngữ.

**US-5 — Thu thập thông tin:** Là chủ workspace, tôi muốn form trước khi chat (`off | optional | required`), kết quả vào `visitor.profile`.

**US-6 — Nút riêng:** Là lập trình viên, tôi muốn ẩn nút mặc định và tự mở chat.

### Phạm vi

- Trong: `ChannelSettings`, `meta`, preview, `identify`, `sender`, "đang soạn", ngữ cảnh trang.
- Ngoài: CSS/HTML tùy ý, theme builder.

### Quy tắc nghiệp vụ

**BR-1** — `ChannelSettings` gồm `theme {color, colorScheme, radius, fontFamily?, logo?}`, `launcher {position, offset, icon?, label?, hidden, zIndex}`, `window {width, height}`, `locales`, `defaultLocale`, `content {brandName, welcomeTitle, welcomeSubtitle, greeting, starters, overrides}`, `preChat {mode, fields[]}`, `features {attachments, sound}`. Giá trị mặc định trong `src/settings/schema.ts`.

**BR-2** — Màu là hex 6 ký tự; `fontFamily` chỉ chữ/số/khoảng trắng/dấu phẩy/ngoặc kép/gạch nối; URL logo/icon chỉ `http(s)`; trường lạ bị từ chối. Máy chủ luôn chuẩn hóa đủ trường nên widget không nhận object thiếu. Khi giá trị đã lưu bị hỏng, chỉ phần (section cấp cao nhất) hỏng lùi về mặc định, phần còn lại được giữ, và channel bị ảnh hưởng được ghi log `[hub] channel <id>: stored settings are invalid in […]` (một lần mỗi tiến trình).

**BR-3** — Màu chữ trên nền thương hiệu tự chọn đen/trắng theo độ sáng (WCAG).

**BR-4** — `preChat.fields[]`: `key` (chữ-số-`_`, duy nhất), `type` (`text|number|name|phone|email`), `required?`, `label?`/`placeholder?` theo locale. `mode=required` không có nút bỏ qua; `identify()` điền sẵn thì bỏ qua các trường đã có.

**BR-5** — Preview `?preview=1` nhận `postMessage({type:'mh:preview', settings, locale?, screen?})` từ parent, vẽ lại ngay, **không** tạo visitor và không gửi tin; settings chưa kiểm được hoàn thiện bằng mặc định và kiểm lại các giá trị đi vào CSS/`src`.

**BR-6** — `sender {id?, name?, avatar?}` của tin trả lời hiện tên và ảnh; `POST …/typing` hiện "đang soạn" tối đa 10 giây; tin `inbound` kèm `context {url,title,referrer}`.

**BR-7** — `MessageHub.identify(profile)` chỉ nhận khóa hợp lệ, giá trị chuỗi/số, tối đa 20 trường; **không xác minh** — không dùng để cấp quyền.

### Tiêu chí nghiệm thu

**AC-1** — Settings thiếu trường vẫn ra object đầy đủ; PATCH từng phần giữ phần còn lại; override key lạ bị từ chối (`tests/api-v1.test.ts`).

**AC-2** — `SETTINGS_DEFAULTS` của trình duyệt bằng default zod; preview từ chối màu/logo nguy hiểm (`tests/widget-logic.test.ts`).

**AC-3** — Trang `public/demo.html` áp preview ngay khi bấm Apply và không tạo visitor (đã kiểm Chrome + DB 2026-10-07).

---

## B. Tham chiếu kỹ thuật

### Code Map

| Vai trò | File |
|---|---|
| Schema zod + kiểm chéo + merge | `src/settings/schema.ts`, `src/settings/index.ts` |
| Mặc định thuần cho trình duyệt | `src/settings/defaults.ts` |
| Theme → biến CSS | `src/widget/theme.ts`, `src/app/globals.css` |
| Form trước khi chat | `src/widget/components/PreChat.tsx` |
| `meta` | `src/app/api/v1/meta/route.ts` |
| Trang thử preview | `public/demo.html` |

### API

| Route | Auth | Mô tả |
|---|---|---|
| `GET /api/v1/meta` | 🔑 | `{version, apiVersion, settings:{jsonSchema, defaults}, locales, messages}` |
| `PATCH /api/v1/channels/[id]` | 🔑 | `settings` deep-merge |

### Vấn đề đã biết

- Font phải có sẵn trên máy visitor (không tải webfont).
- JSON Schema sinh từ zod mô tả kiểu, chưa mô tả đầy đủ ràng buộc chéo (ví dụ `defaultLocale ∈ locales`).
