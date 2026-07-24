#!/usr/bin/env bash
set -euo pipefail

echo "=== Ledger — Run All ==="

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and replace the development values."
  exit 1
fi

echo "Starting Ledger Compose runtime..."
docker compose -f infra/docker-compose.yml up --build
