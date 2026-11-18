#!/usr/bin/env bash
set -euo pipefail

docker image inspect backend-dev >/dev/null 2>&1 || docker build --target dev -t backend-dev .

docker run --rm $( [ -t 0 ] && echo "-it" ) \
  -v "$PWD":/app \
  -v backend_node_modules:/app/node_modules \
  $( [ -f .env ] && echo "--env-file .env" ) \
  backend-dev "$@"
