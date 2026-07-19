#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAOPOS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$LAOPOS_DIR/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

BASE_URL="${BASE_URL:-http://127.0.0.1:${LAOPOS_STACK_PORT:-8081}}"

check_text() {
  local name="$1"
  local url="$2"
  local expect="$3"
  local body
  body="$(curl -fsS "$url")"
  if [[ "$body" != *"$expect"* ]]; then
    echo "FAIL $name: expected '$expect' from $url" >&2
    exit 1
  fi
  echo "PASS $name"
}

check_text "proxy health" "$BASE_URL/healthz" "ok"
check_text "backend health" "$BASE_URL/api-health" '"ok"'
check_text "NextStep POS app shell" "$BASE_URL/laopos/" '<div id="app">'
check_text "service proxy getPOSList" "$BASE_URL/service/v1/getPOSList" '"success":true'

if [[ -n "${SMOKE_EMPLOYEE_USER:-}" && -n "${SMOKE_EMPLOYEE_PASSWORD:-}" ]]; then
  login_body="$(
    curl -fsS \
      -H 'content-type: application/json' \
      -H 'ngrok-skip-browser-warning: 1' \
      -d "{\"user_code\":\"$SMOKE_EMPLOYEE_USER\",\"password\":\"$SMOKE_EMPLOYEE_PASSWORD\"}" \
      "$BASE_URL/service/v1/loginemp"
  )"
  if [[ "$login_body" != *'"success":true'* ]]; then
    echo "FAIL employee login smoke" >&2
    exit 1
  fi
  echo "PASS employee login smoke"
else
  echo "SKIP employee login smoke"
fi

echo "PASS NextStep POS deployed stack: $BASE_URL/laopos/"
