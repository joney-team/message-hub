# Repository Instructions

Message Hub — widget chat self-hosted, một app Next.js duy nhất với SQLite. Đọc [README.md](./README.md) để biết kiến trúc, cách chạy, cấu hình.

## Layout

`src/app/` (route Next) · `src/server/` (config, db, services, queue, realtime, http) · `src/widget/` (UI chat) · `src/i18n/` · `src/settings/` · `src/loader/` (loader nhúng) · `drizzle/` (migration) · `tests/` · `bruno/` · `docs/`.

## Docs

- `docs/prd/message-hub/<feature>/PRD.md` — Feature Spec (mô tả **hiện trạng**, không chứa task). Template: `docs/prd/_TEMPLATE.md`.
- `docs/integration.md` — tài liệu tích hợp cho dự án chính (API, webhook, nhúng widget). Đổi hợp đồng thì sửa file này.
- Prose docs viết **tiếng Việt**, giữ thuật ngữ kỹ thuật tiếng Anh. Code, comment, identifier, UI string: **tiếng Anh**.
- Khi đổi hành vi: cập nhật Part B + `last_verified` của PRD liên quan.

## Quy tắc

- Không commit secret (API key, DB). Cấu hình qua env; xem bảng env trong README. Bruno dùng `environments/local.bru` (git bỏ qua).
- Chạy bản build: `pnpm build && pnpm start` (đừng chạy `.next/standalone/server.js` trực tiếp khi chưa chạy `scripts/prepare-standalone.mjs`).
- Package manager: pnpm 10.11 (không dùng yarn/npm). Trước khi commit chạy `pnpm check` (typecheck + lint + test). Docker: `docker build .`.
- Một instance duy nhất: worker webhook, hub realtime và rate limiter nằm trong bộ nhớ process. Đừng thiết kế thứ cần nhiều instance.
- Webhook ghi vào outbox **trong cùng transaction** với dữ liệu gây ra nó (`enqueueEvent(tx, …)`), rồi gọi `wakeWorker()` sau khi commit.
- Loader (`src/loader/loader.js`): không `fetch`, không thẻ `<style>`, không thuộc tính `style` dạng chuỗi — chỉ CSSOM. Sau khi sửa chạy `pnpm build:loader` và commit `loader.min.ts`.
- Văn bản tin nhắn luôn là text thuần: render bằng React text + `tokenize()` (linkify), không `dangerouslySetInnerHTML`, `t()` không parse HTML.
- Thêm key chuỗi giao diện: thêm vào **mọi** `src/i18n/messages/*.json` (test kiểm đủ key và đúng tham số). Thêm ngôn ngữ: file JSON mới + một dòng trong `catalog.ts` (`LOCALES`, `LOADERS`) và `catalog.server.ts`.
- Đổi schema DB: sửa `schema.ts`, `pnpm db:generate`, commit migration (tự chạy khi khởi động).
- Hợp đồng `/api/v1`, `/api/widget`, payload webhook và API `window.MessageHub` là public — đổi phải cập nhật `docs/integration.md` và PRD.
- Hợp đồng trong `docs/integration.md` là hợp đồng runtime duy nhất. Không thêm route, payload hay adapter fallback cho hệ thống cũ; hướng dẫn cutover chỉ nằm trong `docs/migration.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
