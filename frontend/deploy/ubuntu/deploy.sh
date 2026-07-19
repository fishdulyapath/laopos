#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAOPOS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$LAOPOS_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$LAOPOS_DIR/deploy/ubuntu/docker-compose.images.yml}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Run deploy/ubuntu/install-docker.sh first." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is not available. Run deploy/ubuntu/install-docker.sh first." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it from: $LAOPOS_DIR/deploy/ubuntu/env.production.example" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required=(
  DB_HOST
  DB_PORT
  DB_USER
  DB_PASSWORD
  DB_NAME
  DB_IMAGES_NAME
)

missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "Missing required env values: ${missing[*]}" >&2
  exit 1
fi

cd "$LAOPOS_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -u root laoposservice sh -c 'mkdir -p /app/uploads/customer-display && chown -R node:node /app/uploads'
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo
echo "NextStep POS stack is starting on port ${LAOPOS_STACK_PORT:-8081}."
echo "Run deploy/ubuntu/smoke.sh to verify the deployed stack."
