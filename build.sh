#!/usr/bin/env bash
set -euo pipefail

docker build --target prod --pull -t backend:latest .
docker image ls backend:latest