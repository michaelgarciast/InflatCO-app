#!/usr/bin/env bash
set -euo pipefail

docker network inspect app-net >/dev/null 2>&1 || docker network create app-net

docker build --target dev --pull -t backend-dev .

echo ""
echo "Backend dev disponible en: http://localhost:3000"
echo "Presiona Ctrl+C para detener."
echo ""

docker run --rm -it --init \
  --name backend-dev \
  --network app-net \
  -p 3000:3000 \
  -v "$PWD":/app \
  -v backend_node_modules:/app/node_modules \
  $( [ -f .env ] && echo "--env-file .env" ) \
  backend-dev