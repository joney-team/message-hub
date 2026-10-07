---
feature: files
title: File đính kèm
domain: message-hub
category: Core
status: stable
version: 1.0.0
owner: maintainers
last_verified: 2026-10-07
modules: [src/server/services/files.ts, src/server/files-policy.ts, src/server/http/multipart.ts, src/app/files, src/app/api/widget/files, src/app/api/v1/files, src/widget/components/Composer.tsx]
entities: [files]
routes: [POST /api/widget/files, POST /api/v1/files, GET /files/[id]]
related_plans: []
related_features: [conversations, webhooks]
---

# Feature Spec: File đính kèm

## A. Sản phẩm

### Tổng quan

Visitor và agent đính kèm file vào tin nhắn. File lưu trên đĩa (`DATA_DIR/files/<id>`), metadata trong DB. Vì file do người lạ upload và được phục vụ cùng origin với app, chính sách rất chặt: whitelist loại file, kiểm nội dung, giới hạn dung lượng/tần suất và phục vụ an toàn.

### Quyết định sản phẩm

- Không nhận HTML, SVG, zip, script, file thực thi.
- Chỉ ảnh/âm thanh/video hiển thị inline; còn lại luôn tải xuống.
- Env `FILES_BASE_URL` cho phép phục vụ file từ hostname riêng (phòng Safe Browsing đánh dấu cả domain widget).

### User Stories

**US-1 — Gửi ảnh/tài liệu:** Là visitor, tôi muốn chọn, kéo-thả file hoặc dùng nút camera để chụp/tải ảnh vào khung chat.

**US-2 — Agent gửi file:** Là ứng dụng chính, tôi muốn upload file rồi đính kèm vào câu trả lời.

**US-3 — Tắt đính kèm:** Là chủ workspace, tôi muốn tắt đính kèm (`features.attachments=false`).

### Phạm vi

- Trong: upload, phục vụ, gắn vào tin, dọn file mồ côi.
- Ngoài: xem trước tài liệu, quét virus, object storage.

### Quy tắc nghiệp vụ

**BR-1** — Loại cho phép (theo đuôi **và** magic byte): `png jpg jpeg gif webp mp4 webm mp3 pdf doc xls ppt docx xlsx pptx`, và `txt csv` (chỉ theo đuôi). Khác → 415 `FILE_TYPE_NOT_ALLOWED`. MIME lưu DB do server quyết định, không lấy từ client.

**BR-2** — Tối đa `MAX_UPLOAD_MB` (mặc định 10): thân request bị cắt ngay khi vượt (413 `FILE_TOO_LARGE`/`PAYLOAD_TOO_LARGE`), không đọc hết vào RAM.

**BR-3** — Visitor upload cần token và `features.attachments`; 10 file/phút/visitor. API key upload cần `channelId` thuộc owner; 60 file/phút/owner.

**BR-4** — Visitor chỉ đính kèm file do chính mình upload; file phải cùng channel.

**BR-5** — `GET /files/[id]`: id sai định dạng/lạ → 404; `Content-Type` từ DB, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition` `inline` (media) hoặc `attachment`, `Cache-Control: public, max-age=31536000, immutable`, `Cross-Origin-Resource-Policy: cross-origin`.

**BR-6** — Dọn mỗi giờ (một lượt đọc các tin có đính kèm, không quét theo từng file): file không tin nào tham chiếu sau 24 giờ; file trên đĩa không có dòng DB. Xóa channel xóa file trên đĩa.

**BR-7** — Khi attachment được bật, composer có nút file cho mọi loại được hỗ trợ và nút camera riêng chỉ nhận `png`, `jpeg`, `gif`, `webp`; trên thiết bị hỗ trợ, nút camera ưu tiên camera sau. Cả hai dùng chung luồng upload, giới hạn và validation phía server.

### Tiêu chí nghiệm thu

**AC-1** — `.html`, `.svg`, `.js`, `.exe`, không đuôi bị từ chối; HTML đội lốt `.png` bị từ chối (`tests/files.test.ts`).

**AC-2** — `GET /files/..%2F..%2Fetc%2Fpasswd` và id lạ → 404.

**AC-3** — Vượt dung lượng → 413; vượt tần suất → 429.

---

## B. Tham chiếu kỹ thuật

### Code Map

| Vai trò | File |
|---|---|
| Chính sách | `src/server/files-policy.ts` |
| Đọc multipart có giới hạn | `src/server/http/multipart.ts` |
| Service + dọn rác | `src/server/services/files.ts` |
| Routes | `src/app/api/widget/files`, `src/app/api/v1/files`, `src/app/files/[id]` |
| UI | `src/widget/components/Composer.tsx` (chọn, kéo-thả, camera), `MessageBubble.tsx` |

### Data Model

`files(id, channel_id, visitor_id?, name, mime, size, created_at)`; tên chỉ để hiển thị (đã làm sạch), file trên đĩa đặt theo `id`.

### API

| Route | Auth | Mô tả |
|---|---|---|
| `POST /api/widget/files` | 👤 | multipart `file` → `{id, name, mime, size, url}` |
| `POST /api/v1/files` | 🔑 | multipart `channelId` + `file` |
| `GET /files/[id]` | public (id không đoán được) | Tải file |

### Host Production

Môi trường container đặt `PUBLIC_URL=https://message-hub.example.com` và `FILES_BASE_URL=https://files.message-hub.example.com`. Upload gọi API trên `message-hub.example.com`; URL tải file trong API và webhook dùng `https://files.message-hub.example.com/files/<id>`. Hai domain trỏ vào cùng app, cổng 4200; không thêm instance hay dịch vụ lưu file riêng.

Runtime vẫn cho phép không đặt `FILES_BASE_URL`: URL file trong API khi đó là tương đối, webhook lùi về `PUBLIC_URL`. Các hostname production được cấu hình qua env, không hardcode trong service.

### Vấn đề đã biết

- Dung lượng giới hạn từng file, chưa có hạn mức theo channel.
- `url` trong webhook chỉ tuyệt đối khi đặt `PUBLIC_URL` hoặc `FILES_BASE_URL`.
