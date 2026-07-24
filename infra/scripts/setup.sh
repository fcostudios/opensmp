#!/usr/bin/env bash
set -euo pipefail

echo "=== Ledger — Setup ==="

# 1. Start infrastructure
echo "[1/4] Starting Docker services..."
docker compose -f infra/docker-compose.yml up -d

# 2. Wait for health
echo "[2/4] Waiting for PostgreSQL..."
until docker exec app-postgres pg_isready -U app >/dev/null 2>&1; do
  sleep 1
done
echo "  PostgreSQL is ready."

echo "  Waiting for Keycloak..."
until curl -sf http://localhost:8180/health/ready >/dev/null 2>&1; do
  sleep 2
done
echo "  Keycloak is ready."

# 3. Build backend
echo "[3/4] Building Spring Boot API..."
cd apps/api && ./gradlew build -x test && cd ../..

# 4. Install frontend
echo "[4/4] Installing frontend dependencies..."
cd apps/web && pnpm install && cd ../..

echo "=== Setup complete. Run 'infra/scripts/run-all.sh' to start. ==="
