#!/usr/bin/env bash
# Build the image on this machine, push it, and ask Dokploy to redeploy.
#
#   ./deploy.sh                 check, build, push <version> + latest, redeploy, wait until healthy
#   ./deploy.sh patch           bump the version first (patch | minor | major), then the same
#   ./deploy.sh --build-only    build for linux/amd64 and load it locally; nothing is pushed
#   ./deploy.sh --skip-checks   skip `pnpm check`
#
# Settings come from .env.deploy (see .env.deploy.example).
set -euo pipefail
cd "$(dirname "$0")"

BUMP=""
BUILD_ONLY=0
SKIP_CHECKS=0
for arg in "$@"; do
  case "$arg" in
    patch | minor | major) BUMP="$arg" ;;
    --build-only) BUILD_ONLY=1 ;;
    --skip-checks) SKIP_CHECKS=1 ;;
    -h | --help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ -f .env.deploy ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.deploy
  set +a
fi
IMAGE="${IMAGE:-message-hub}"
PLATFORM="${PLATFORM:-linux/amd64}"

step() { printf '\n▶ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker is not installed"
docker buildx version >/dev/null 2>&1 || fail "docker buildx is not available"

if [ "$BUILD_ONLY" -eq 0 ] && [ -n "$(git status --porcelain)" ]; then
  fail "Working tree has uncommitted changes. Commit or stash them so the image matches a commit."
fi
if [ "$BUILD_ONLY" -eq 0 ] && [ "$IMAGE" = "message-hub" ]; then
  fail "Set IMAGE in .env.deploy to a registry image, for example ghcr.io/your-org/message-hub"
fi

if [ "$SKIP_CHECKS" -eq 0 ]; then
  step "pnpm check"
  pnpm check
fi

if [ -n "$BUMP" ]; then
  [ "$BUILD_ONLY" -eq 0 ] || fail "Do not bump the version together with --build-only"
  step "Bumping version ($BUMP)"
  pnpm version "$BUMP" --no-git-tag-version >/dev/null
  git commit -qam "Release $(node -p "require('./package.json').version")"
fi

VERSION=$(node -p "require('./package.json').version")
REVISION=$(git rev-parse --short HEAD)

if [ "$BUILD_ONLY" -eq 1 ]; then
  step "Building $IMAGE:$VERSION for $PLATFORM (local only)"
  docker buildx build --platform "$PLATFORM" --tag "$IMAGE:$VERSION" --load .
  printf '\n✓ Built %s:%s. Try it:\n' "$IMAGE" "$VERSION"
  printf '  docker run --rm -p 4200:4200 -v mh-data:/data -e API_KEYS=dev:%s %s:%s\n' "$(printf 'x%.0s' {1..20})" "$IMAGE" "$VERSION"
  exit 0
fi

step "Building and pushing $IMAGE:$VERSION ($REVISION) for $PLATFORM"
docker buildx build \
  --platform "$PLATFORM" \
  --label "org.opencontainers.image.version=$VERSION" \
  --label "org.opencontainers.image.revision=$REVISION" \
  --tag "$IMAGE:$VERSION" \
  --tag "$IMAGE:latest" \
  --push \
  .

if [ -z "${DOKPLOY_URL:-}" ] || [ -z "${DOKPLOY_API_KEY:-}" ] || [ -z "${DOKPLOY_APP_ID:-}" ]; then
  printf '\n✓ Pushed %s:%s and :latest.\n' "$IMAGE" "$VERSION"
  echo "  Dokploy is not configured in .env.deploy: open the application in Dokploy and press Deploy."
  exit 0
fi

step "Asking Dokploy to redeploy"
status=$(curl -sS -o /tmp/mh-dokploy.out -w '%{http_code}' -X POST "$DOKPLOY_URL/api/application.deploy" \
  -H "x-api-key: $DOKPLOY_API_KEY" \
  -H 'content-type: application/json' \
  -d "{\"applicationId\":\"$DOKPLOY_APP_ID\"}") || fail "Could not reach Dokploy at $DOKPLOY_URL"
if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
  echo "Dokploy answered HTTP $status:" >&2
  head -c 500 /tmp/mh-dokploy.out >&2 || true
  echo >&2
  fail "The image is pushed, but the redeploy was not started. Press Deploy in Dokploy."
fi

if [ -z "${PUBLIC_URL:-}" ]; then
  printf '\n✓ Redeploy started. PUBLIC_URL is not set in .env.deploy, so the result was not checked.\n'
  exit 0
fi

step "Waiting for $PUBLIC_URL to serve version $VERSION"
for _ in $(seq 1 60); do
  body=$(curl -fsS --max-time 5 "$PUBLIC_URL/api/health" 2>/dev/null || true)
  case "$body" in
    *"\"version\":\"$VERSION\""*) printf '✓ Live: %s\n' "$body"; exit 0 ;;
  esac
  sleep 5
done
fail "Still not serving $VERSION after 5 minutes. Check the deployment log in Dokploy. Last answer: ${body:-none}"
