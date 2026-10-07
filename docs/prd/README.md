# Message Hub — Feature Specs (PRD)

Đặc tả tính năng của **Message Hub**. Mỗi Spec ở `docs/prd/message-hub/<feature>/PRD.md` gồm **A. Sản phẩm** (đọc hiểu) và **B. Tham chiếu kỹ thuật** (Code Map, Data Model, API — dùng để định vị code trước khi sửa).

**Quy ước:** ID ổn định `US-n` / `BR-n` / `AC-n`; Spec chỉ mô tả hiện trạng, **không chứa task**; luôn xem `version` và `last_verified` và đối chiếu code nếu nghi ngờ. Template: [_TEMPLATE.md](_TEMPLATE.md). Thuật ngữ: [GLOSSARY.md](GLOSSARY.md). Hợp đồng cho dự án chính: [../integration.md](../integration.md).

Trạng thái: ✅ đã có Spec · 📝 chưa viết.

| Feature | Doc | Status | Modules |
|---|---|---|---|
| channels | [✅](message-hub/channels/PRD.md) | stable | `services/channels`, `app/api/v1/channels` |
| widget-sdk | [✅](message-hub/widget-sdk/PRD.md) | stable | `loader/`, `app/embed`, `app/w`, `proxy.ts`, `widget/useHost` |
| conversations | [✅](message-hub/conversations/PRD.md) | stable | `services/{sessions,messages,visitors}`, `realtime/`, `app/api/widget`, `widget/` |
| files | [✅](message-hub/files/PRD.md) | stable | `services/files`, `files-policy`, `app/files`, `http/multipart` |
| webhooks | [✅](message-hub/webhooks/PRD.md) | stable | `queue/`, `services/deliveries`, `app/api/v1/deliveries` |
| i18n | [✅](message-hub/i18n/PRD.md) | stable | `i18n/`, `widget/I18n.tsx` |
| customization | [✅](message-hub/customization/PRD.md) | stable | `settings/`, `widget/theme.ts`, `app/api/v1/meta`, preview |
