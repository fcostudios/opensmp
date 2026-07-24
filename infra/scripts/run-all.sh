#!/usr/bin/env bash
set -euo pipefail

echo "=== Ledger — Run All ==="

# Ensure infra is up
docker compose -f infra/docker-compose.yml up -d

# Start backend
echo "Starting Spring Boot API on :8080..."
cd apps/api && ./gradlew bootRun --args='--spring.profiles.active=dev' &
API_PID=$!
cd ../..

# Start frontend
echo "Starting Next.js on :3000..."
cd apps/web && pnpm dev &
WEB_PID=$!
cd ../..

echo "API PID=$API_PID | Web PID=$WEB_PID"
echo "Press Ctrl+C to stop all."

trap "kill $API_PID $WEB_PID 2>/dev/null; exit" INT TERM
wait
