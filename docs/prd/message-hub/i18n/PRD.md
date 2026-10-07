---
feature: i18n
title: Đa ngôn ngữ
domain: message-hub
category: Core
status: stable
version: 1.0.0
owner: maintainers
last_verified: 2026-10-07
modules: [src/i18n, src/widget/I18n.tsx, src/settings/index.ts]
entities: [channels, visitors]
routes: [GET /api/v1/meta]
related_plans: []
related_features: [customization, widget-sdk, webhooks]
---

# Feature Spec: Đa ngôn ngữ

## A. Sản phẩm

### Tổng quan

Giao diện chat dùng được nhiều ngôn ngữ ngay từ thiết kế và đổi ngôn ngữ **lúc chạy** mà không tải lại iframe (hợp với site SPA). Hỗ trợ 8 locale: `en`, `vi`, `ko`, `zh` (Chinese giản thể), `ja`, `th`, `fr`, `ru`.

### Quyết định sản phẩm

- Hai loại chuỗi: **chuỗi giao diện** (thuộc app, trong catalog) và **chuỗi nội dung** (thuộc channel, `LocalizedText`).
- Locale của visitor được lưu và gửi kèm webhook để dự án chính/AI agent trả lời đúng ngôn ngữ.
- Không dùng thư viện i18n; `t()` chỉ trả chuỗi thuần (không parse HTML).

### User Stories

**US-1 — Đúng ngôn ngữ tự động:** Là visitor, tôi muốn chat theo ngôn ngữ của trang/trình duyệt của tôi.

**US-2 — Đổi ngôn ngữ site:** Là lập trình viên, tôi muốn gọi `MessageHub.setLocale('en')` khi site đổi ngôn ngữ.

**US-3 — Sửa câu chữ:** Là chủ workspace, tôi muốn đổi chữ trên nút/ô nhập mà không cần deploy lại Message Hub.

**US-4 — Thêm ngôn ngữ:** Là lập trình viên Message Hub, tôi muốn thêm ngôn ngữ chỉ bằng một file JSON và các dòng đăng ký catalog.

### Phạm vi

- Trong: catalog, chọn locale, định dạng `Intl`, `LocalizedText`, override theo channel, logical properties/`dir` cho RTL.
- Ngoài: dịch tự động, ngôn ngữ RTL cụ thể (hạ tầng đã sẵn).

### Quy tắc nghiệp vụ

**BR-1** — Catalog `src/i18n/messages/<locale>.json`, key phẳng, tham số `{name}`; `en` là nguồn, key có type; mọi locale phải có đúng tập key và tham số của `en` (test).

**BR-2** — Thứ tự chọn locale (chỉ trong `settings.locales`, rút gọn `vi-VN → vi`): chỉ định tường minh (`data-locale`, `setLocale`, `?locale=`) → `<html lang>` của trang chủ → `navigator.languages` → `defaultLocale`.

**BR-3** — Tra chuỗi giao diện: `content.overrides[locale][key]` → catalog của locale → catalog `en`. Key lạ hoặc locale không hỗ trợ bị từ chối khi lưu (400).

**BR-4** — `LocalizedText` lùi về `defaultLocale`, rồi chuỗi mặc định trong catalog.

**BR-5** — Ngày giờ, số, kích thước dùng `Intl` theo locale; "Hôm nay/Hôm qua" lấy từ `Intl.RelativeTimeFormat`.

**BR-6** — Iframe chỉ tải catalog của locale hiện tại (+ `en` làm dự phòng); `<html lang dir>` cập nhật khi đổi.

**BR-7** — Lỗi API trả `{error:{code,message}}`; UI dịch theo `code` (`error.<CODE>`).

**BR-8** — Danh sách hỗ trợ gồm `en`, `vi`, `ko`, `zh`, `ja`, `th`, `fr`, `ru`; `zh` dùng chuỗi Chinese giản thể. Channel mặc định bật `["en", "vi"]`, mặc định ngôn ngữ `en`. Ngôn ngữ bổ sung phải được bật trong `settings.locales`; không tự sửa channel đã lưu.

### Tiêu chí nghiệm thu

**AC-1** — Thứ tự chọn locale, dịch + fallback, override, parity catalog (`tests/widget-logic.test.ts`).

**AC-2** — `setLocale` đổi ngôn ngữ nút launcher và toàn bộ khung chat không tải lại (kiểm Chrome 2026-10-07).

**AC-3** — Cả 8 catalog có đủ key và placeholder, đăng ký client/server đồng nhất; 6 locale mới hoạt động với mã vùng, settings create/PATCH, `meta`, launcher `setLocale`, visitor locale và webhook (`tests/widget-logic.test.ts`, `tests/api-v1.test.ts`, `tests/loader.test.ts`, `tests/widget-api.test.ts`).

### Thêm ngôn ngữ

1. `src/i18n/messages/<code>.json` (đủ key như `en.json`).
2. Một dòng trong `LOCALES` và `LOADERS` (`src/i18n/catalog.ts`), một dòng trong `ALL_CATALOGS` (`catalog.server.ts`).
3. Bật trong `settings.locales` của channel.

---

## B. Tham chiếu kỹ thuật

### Code Map

| Vai trò | File |
|---|---|
| Danh sách locale, loader lười | `src/i18n/catalog.ts` |
| Catalog đầy đủ phía server, kiểm key | `src/i18n/catalog.server.ts` |
| Chọn locale, dịch, `Intl` | `src/i18n/index.ts` |
| Context UI | `src/widget/I18n.tsx` |
| Kiểm override khi lưu | `src/settings/index.ts` |
| Chuỗi launcher trong loader | `src/loader/build.ts` |

### Data Model

`visitors.locale` — locale đã chọn (nằm trong `settings.locales`), có trong payload webhook (`data.visitor.locale`).

Catalog client và server đăng ký cùng 8 locale: `en`, `vi`, `ko`, `zh`, `ja`, `th`, `fr`, `ru`, tất cả `dir: ltr`. `settings.locales` mặc định vẫn là `["en", "vi"]` ở cả schema server và defaults browser; muốn dùng locale khác phải bật cho channel, không tự sửa cấu hình channel đã lưu.

### API

| Route | Auth | Mô tả |
|---|---|---|
| `GET /api/v1/meta` | 🔑 | `locales`, toàn bộ catalog theo locale (dựng màn hình "sửa câu chữ") |

### Kiểm thử

- `tests/widget-logic.test.ts`: đối chiếu file JSON với đăng ký client/server, parity key/placeholder cho mọi catalog, lazy loading, English fallback, override, mã vùng và `Intl`.
- `tests/api-v1.test.ts`: 6 locale mới trong create/PATCH và override; `meta` trả đủ 8 locale/catalog, mặc định vẫn `en/vi`, locale lạ bị từ chối.
- `tests/loader.test.ts`: đổi ngôn ngữ launcher với 6 locale mới, giữ nguyên iframe và gửi `mh:locale`.
- `tests/widget-api.test.ts`: tạo/đổi locale visitor theo mã vùng và payload outbox của `visitor.created`, `visitor.updated`, `message.created`; locale không bật không thay locale đã lưu.

Xác minh 2026-10-07: `pnpm check` pass (229 test, 11 file); build production bằng `pnpm build --webpack` pass. Playwright trên standalone với DB QA riêng kiểm 38 màn hình: welcome/prechat/chat cho 6 locale mới ở 320/380 px và hộp thoại kết thúc chat French/Russian ở 320 px; không có lỗi runtime hoặc tràn nội dung. Build Turbopack mặc định bị môi trường kiểm thử chặn port nội bộ của PostCSS; không đổi cấu hình build repo.

### Vấn đề đã biết

- Chưa có ngôn ngữ RTL thật để thử `dir="rtl"`; CSS dùng logical properties.
