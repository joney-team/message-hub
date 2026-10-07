# Self-hosting Message Hub

Message Hub is distributed as source code and a Dockerfile. You operate the deployment and are responsible for its security, availability, storage, backups, upgrades, and legal compliance.

## Requirements

- Exactly one running application instance
- A persistent volume mounted at `/data`
- HTTPS in front of the application
- Node.js 22 and pnpm 10.11 when building outside Docker

The webhook worker, realtime hub, and rate limiters are process-local. Running multiple replicas can duplicate webhook delivery and split realtime connections.

## Docker

Build the image:

```bash
docker build -t message-hub:local .
```

Generate a production API key:

```bash
openssl rand -base64 32 | tr -d '=+/'
```

Run:

```bash
docker run -d \
  --name message-hub \
  -p 4200:4200 \
  -v message-hub-data:/data \
  -e API_KEYS=admin:<random-key> \
  -e PUBLIC_URL=https://message-hub.example.com \
  -e TRUSTED_PROXIES=1 \
  message-hub:local
```

Optional separate file hostname:

```text
FILES_BASE_URL=https://files.message-hub.example.com
```

Both hostnames must route to the same application and container port. Upload requests still go to the main hostname; generated file URLs use `FILES_BASE_URL`.

## Production Environment

Start from [.env.production.example](../.env.production.example).

| Variable | Guidance |
|---|---|
| `API_KEYS` | Required. Use random keys of at least 16 characters. Store them in the platform's secret manager. |
| `PUBLIC_URL` | Public HTTPS origin for the API, loader, and widget. |
| `FILES_BASE_URL` | Optional HTTPS origin for file downloads. |
| `TRUSTED_PROXIES` | Number of trusted proxy hops appending to `X-Forwarded-For`. Use `0` when exposed directly. |
| `MAX_UPLOAD_MB` | Ensure every proxy/CDN request-body limit is larger than this value. |
| `MESSAGE_RETENTION_DAYS` | `0` keeps conversations indefinitely. Select a value that matches your privacy policy. |

The image already sets `NODE_ENV=production`, `PORT=4200`, `HOSTNAME=0.0.0.0`, and `DATA_DIR=/data`.

## Reverse Proxy

- Terminate TLS at the proxy.
- Append the client address to `X-Forwarded-For`.
- Set `TRUSTED_PROXIES` to the actual number of trusted hops.
- Disable response buffering for `/api/widget/stream`.
- Do not add `X-Frame-Options` to `/w/*`; embedding is controlled by CSP `frame-ancestors`.
- Preserve long-lived SSE connections and normal `Cache-Control` headers.

Example nginx forwarding:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_buffering off;
```

Apply buffering rules narrowly if the proxy also serves other applications.

## Deployments and Upgrades

Use stop-first deployment:

1. Back up `/data`.
2. Stop the existing instance.
3. Start the new image with the same volume.
4. Wait for `/api/health`.
5. Verify the widget, file download, SSE, and webhook delivery.

Database migrations run automatically at startup and only move forward. Test upgrades against a copy of production data before rollout.

## Health Check

```bash
curl https://message-hub.example.com/api/health
```

The Docker image includes a health check against `http://127.0.0.1:4200/api/health`.

## Backup

Hot backup from the host:

```bash
docker exec <container> node scripts/backup.mjs /data/backups/$(date +%F)
docker cp <container>:/data/backups/$(date +%F) ./message-hub-backup
```

The script uses SQLite's backup API and copies uploaded files. Do not copy `hub.db` directly while the application is running because recent data may still be in the WAL.

Store backups outside the application host, encrypt them, test restores, and define retention.

To restore:

1. Stop the application.
2. Restore `hub.db` and `files/` at the root of the volume.
3. Remove stale `hub.db-wal` and `hub.db-shm` files.
4. Start the application and verify `/api/health`.

## Uploaded Content

Message Hub validates supported file types and sizes, but it does not include antivirus or malware scanning. Operators should add scanning, moderation, storage quotas, and abuse controls appropriate to their threat model.

## Optional Registry and Dokploy Script

[`deploy.sh`](../deploy.sh) can build and push an image, then optionally call a Dokploy redeploy endpoint.

```bash
cp .env.deploy.example .env.deploy
# Set IMAGE and optionally DOKPLOY_URL, DOKPLOY_API_KEY, DOKPLOY_APP_ID.
./deploy.sh --build-only
./deploy.sh
```

This script is optional. Kubernetes, Docker Compose, systemd, Nomad, and other platforms are supported as long as they preserve the single-instance and persistent-volume requirements.
