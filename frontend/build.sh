#!/usr/bin/env bash
set -euo pipefail

IMAGE="inflatco-frontend"

docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -t "$IMAGE" .

docker run --rm -it \
  -u "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD/app":/app \
  "$IMAGE" \
  sh -c '[ -d node_modules ] || bun install; bun run build'