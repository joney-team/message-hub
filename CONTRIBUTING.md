# Contributing

Thank you for contributing to Message Hub.

## Before You Start

- Use GitHub Issues for confirmed bugs and focused feature proposals.
- Do not include API keys, tokens, private URLs, customer data, database files, or logs containing personal data.
- Report security issues privately according to [SECURITY.md](SECURITY.md).
- Keep changes scoped to one concern and follow the existing architecture.

## Development Setup

Requirements:

- Node.js 22 or newer
- pnpm 10.11

```bash
pnpm install
pnpm check
pnpm build
```

For local development:

```bash
pnpm dev
```

## Pull Requests

1. Create a branch from `main`.
2. Add focused tests for behavior changes.
3. Run `pnpm check` and `pnpm build`.
4. Update public contracts in `docs/integration.md` and the related PRD.
5. If `src/loader/loader.js` changes, run `pnpm build:loader` and commit `src/loader/loader.min.ts`.
6. If the database schema changes, run `pnpm db:generate` and commit the migration.
7. Describe operational impact, compatibility, and verification in the pull request.

By submitting a contribution, you agree that it is licensed under the MIT License of this repository.

## Project Constraints

- Run exactly one application instance.
- Write webhook events to the outbox in the same transaction as the triggering data.
- Render message text as plain text; do not introduce HTML parsing.
- Treat `/api/v1`, `/api/widget`, webhook payloads, and `window.MessageHub` as public contracts.
- Never add a compatibility fallback for the retired implementation.
