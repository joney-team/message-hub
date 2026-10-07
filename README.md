# Message Hub

Message Hub is a self-hosted, embeddable customer chat widget. It runs as a single Next.js application with SQLite, signed webhooks, Server-Sent Events, file attachments, localization, and a framework-agnostic loader.

There is no hosted service, cloud dependency, Redis, or external database requirement.

## Features

- One container and one persistent volume
- Embeddable widget loaded with a single `<script>` tag
- Anonymous visitor sessions with realtime replies over SSE
- Signed, transactional webhook outbox with retry
- File attachments with type and size validation
- Per-channel themes, content, pre-chat forms, and origin restrictions
- Eight UI languages: English, Vietnamese, Korean, Simplified Chinese, Japanese, Thai, French, and Russian
- Public management API and live settings preview

## Quick Start

Requirements:

- Node.js 22 or newer
- pnpm 10.11

```bash
pnpm install
pnpm dev
```

The development server starts at `http://localhost:4200`. When `API_KEYS` is unset outside production, the development key is:

```text
dev-only-api-key-change-me
```

Create a channel:

```bash
curl -sS -X POST http://localhost:4200/api/v1/channels \
  -H 'Authorization: Bearer dev-only-api-key-change-me' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo"}'
```

Then open:

```text
http://localhost:4200/demo.html?channel=<channel-id>
```

## Docker

```bash
docker build -t message-hub .
docker run --rm -p 4200:4200 \
  -v message-hub-data:/data \
  -e API_KEYS=admin:replace-with-a-random-key-at-least-16-chars \
  -e PUBLIC_URL=https://message-hub.example.com \
  message-hub
```

Production requires HTTPS, a persistent volume mounted at `/data`, and exactly one running instance.

Or use Docker Compose:

```bash
cp .env.example .env
# Replace API_KEYS before starting.
docker compose up -d --build
```

## Embed

After creating a channel, add the loader to the customer website:

```html
<script src="https://message-hub.example.com/embed/ch_xxx.js" async></script>
```

Replace the example hostname with your deployment. See [the integration guide](docs/integration.md) for the API, webhooks, CSP, widget API, localization, and preview protocol.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `API_KEYS` | Required in production | Comma-separated `owner:key` pairs; each key must be at least 16 characters |
| `DATA_DIR` | `./data` (`/data` in the image) | SQLite database and uploaded files |
| `PORT` | `4200` | HTTP port |
| `PUBLIC_URL` | None | Public HTTPS URL used to produce absolute file URLs in webhooks |
| `FILES_BASE_URL` | Same host | Optional separate hostname for uploaded files |
| `TRUSTED_PROXIES` | `1` | Number of trusted reverse proxies appending to `X-Forwarded-For`; use `0` with no proxy |
| `MAX_UPLOAD_MB` | `10` | Maximum upload size |
| `MESSAGE_RETENTION_DAYS` | `0` | Delete inactive visitors and conversations after this many days; `0` keeps them indefinitely |

See [.env.example](.env.example) and [.env.production.example](.env.production.example).

## Architecture

```text
Customer website
  └─ /embed/<channel>.js
       └─ iframe /w/<channel>
            ├─ /api/widget/*  visitor token
            └─ SSE stream

Main application
  ├─ /api/v1/*                API key
  └─ signed webhooks          transactional outbox

Message Hub
  └─ SQLite + files in DATA_DIR
```

Message Hub deliberately runs as a single instance. The webhook worker, realtime hub, and rate limiters are process-local.

## Operator Responsibility

This project is provided as self-hosted software. Operators are responsible for:

- TLS, DNS, reverse-proxy configuration, and network access
- Generating, storing, and rotating API keys and webhook secrets
- Persistent storage, backups, restores, retention, and disaster recovery
- Monitoring, upgrades, vulnerability patching, and availability
- Reviewing uploaded content and adding malware scanning when required
- Privacy notices, consent, data residency, and regulatory compliance
- Restricting `allowedOrigins` and configuring `TRUSTED_PROXIES` correctly

The maintainers do not provide an SLA or operate your deployment.

## Development

```bash
pnpm check          # typecheck + lint + tests
pnpm build          # production build and standalone preparation
pnpm build:loader   # regenerate src/loader/loader.min.ts
pnpm db:generate    # generate a migration after changing the DB schema
pnpm db:backup      # hot backup
```

API examples are available in [`bruno/`](bruno).

## Documentation

- [Integration guide](docs/integration.md)
- [Self-hosting and deployment](docs/deploy.md)
- [Migration from the legacy implementation](docs/migration.md)
- [Feature specifications](docs/prd/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
