# Message Hub — Docs

| Thư mục | Nội dung | Quy ước |
|---|---|---|
| [`prd/`](prd/README.md) | Feature Spec từng tính năng (`prd/message-hub/<feature>/PRD.md`): Part A sản phẩm, Part B tham chiếu kỹ thuật | Mô tả **hiện trạng**, không chứa task. Template: [`prd/_TEMPLATE.md`](prd/_TEMPLATE.md) |
| [`integration.md`](integration.md) | Hợp đồng runtime và hướng dẫn tích hợp cho dự án chính: API, webhook, nhúng widget, `window.MessageHub`, tùy biến | Xem riêng [Widget runtime API](integration.md#43-điều-khiển-widget-windowmessagehub) |
| [`migration.md`](migration.md) | Hướng dẫn chuyển tích hợp cũ sang hợp đồng hiện tại | Checklist cutover, không vận hành song song |
| [`deploy.md`](deploy.md) | Self-host bằng Docker, reverse proxy, backup, upgrade và tùy chọn Dokploy | — |

Khi đổi hành vi, cập nhật PRD liên quan (Part B + `last_verified`) cùng code và test.

Ngôn ngữ: prose tiếng Việt, thuật ngữ kỹ thuật tiếng Anh; code/comment/identifier/UI string tiếng Anh.
