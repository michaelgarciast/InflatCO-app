#!/usr/bin/env bash
set -euo pipefail

IMAGE="inflatco-frontend"

docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build --target dev -t "$IMAGE" .

docker run --rm $( [ -t 0 ] && echo "-it" ) \
  -u "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD/app":/app \
  $( [ -f app/.env ] && echo "--env-file app/.env" ) \
  "$IMAGE" "$@"
