#!/usr/bin/env bash
set -euo pipefail

IMAGE="inflatco-frontend"

docker network inspect app-net >/dev/null 2>&1 || docker network create app-net

docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build --target dev -t "$IMAGE" .

docker run --rm -it \
  --name frontend-dev \
  --network app-net \
  -u "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -p 5173:5173 \
  -v "$PWD/app":/app \
  $( [ -f app/.env ] && echo "--env-file app/.env" ) \
  "$IMAGE" \
  sh -c '[ -d node_modules ] || bun install; bun --bun run dev --host 0.0.0.0'
