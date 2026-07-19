#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAOPOS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE_DIR="$(cd "$LAOPOS_DIR/.." && pwd)"
API_DIR="${API_DIR:-$WORKSPACE_DIR/backend}"

TAG="${1:-${IMAGE_TAG:-latest}}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
API_IMAGE="${LAOPOS_SERVICE_IMAGE:-minorsoft/laoposservice}"
APP_IMAGE="${LAOPOS_WEB_IMAGE:-minorsoft/laoposweb}"
BUILDER="${BUILDER:-laopos-builder}"
PUSH_LATEST="${PUSH_LATEST:-0}"

VITE_API_BASE_URL="${VITE_API_BASE_URL:-/service/v1}"
VITE_BASE_PATH="${VITE_BASE_PATH:-/laopos/}"
VITE_TIGER_MOCK="${VITE_TIGER_MOCK:-false}"
VITE_CHANGE_CURRENCY_CODE="${VITE_CHANGE_CURRENCY_CODE:-KIP}"
VITE_CHANGE_ROUNDING_STEP="${VITE_CHANGE_ROUNDING_STEP:-500}"
VITE_CHANGE_ROUNDING_MODE="${VITE_CHANGE_ROUNDING_MODE:-down}"
VITE_CHANGE_ROUNDING_INCOME_CODE="${VITE_CHANGE_ROUNDING_INCOME_CODE:-RD-002}"

if [[ ! -d "$API_DIR" ]]; then
  echo "Missing backend directory: $API_DIR" >&2
  echo "Set API_DIR=/path/to/backend if it is not beside NextStep POS." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not in PATH." >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker buildx is not available." >&2
  exit 1
fi

if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER" --use >/dev/null
else
  docker buildx use "$BUILDER" >/dev/null
fi

docker buildx inspect --bootstrap >/dev/null

api_tags=(-t "$API_IMAGE:$TAG")
app_tags=(-t "$APP_IMAGE:$TAG")

if [[ "$PUSH_LATEST" == "1" && "$TAG" != "latest" ]]; then
  api_tags+=(-t "$API_IMAGE:latest")
  app_tags+=(-t "$APP_IMAGE:latest")
fi

echo "Building and pushing API image: ${api_tags[*]}"
docker buildx build \
  --platform "$PLATFORMS" \
  --push \
  "${api_tags[@]}" \
  "$API_DIR"

echo "Building and pushing app image: ${app_tags[*]}"
docker buildx build \
  --platform "$PLATFORMS" \
  --push \
  --build-arg "VITE_API_BASE_URL=$VITE_API_BASE_URL" \
  --build-arg "VITE_BASE_PATH=$VITE_BASE_PATH" \
  --build-arg "VITE_TIGER_MOCK=$VITE_TIGER_MOCK" \
  --build-arg "VITE_CHANGE_CURRENCY_CODE=$VITE_CHANGE_CURRENCY_CODE" \
  --build-arg "VITE_CHANGE_ROUNDING_STEP=$VITE_CHANGE_ROUNDING_STEP" \
  --build-arg "VITE_CHANGE_ROUNDING_MODE=$VITE_CHANGE_ROUNDING_MODE" \
  --build-arg "VITE_CHANGE_ROUNDING_INCOME_CODE=$VITE_CHANGE_ROUNDING_INCOME_CODE" \
  "${app_tags[@]}" \
  "$LAOPOS_DIR"

echo
echo "Pushed:"
echo "- $API_IMAGE:$TAG"
echo "- $APP_IMAGE:$TAG"

if [[ "$PUSH_LATEST" == "1" && "$TAG" != "latest" ]]; then
  echo "- $API_IMAGE:latest"
  echo "- $APP_IMAGE:latest"
fi
