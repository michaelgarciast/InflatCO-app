#!/usr/bin/env bash
set -euo pipefail

if [ -f package.json ]; then
  echo "Error: ya existe package.json en este directorio." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker no está corriendo. Inicia Docker Desktop primero." >&2
  exit 1
fi

echo "Generando proyecto NestJS con @nestjs/cli (vía Docker)..."

docker run --rm \
  -v "$PWD":/workspace \
  -w /workspace \
  oven/bun:1-alpine \
  sh -c "bunx @nestjs/cli new .tmp-nest --package-manager bun --skip-git"

shopt -s dotglob nullglob
mv .tmp-nest/* .
rmdir .tmp-nest

echo "Proyecto NestJS creado correctamente."
echo "Siguientes pasos:"
echo "  ./dev.sh    # desarrollo con hot-reload"
echo "  ./build.sh  # build de producción"
