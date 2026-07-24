#!/usr/bin/env bash
set -euo pipefail

echo "=== Resetting database ==="
docker exec app-postgres psql -U app -c "DROP DATABASE IF EXISTS app;"
docker exec app-postgres psql -U app -c "CREATE DATABASE app;"
echo "Database recreated. Run migrations with: cd apps/api && ./gradlew flywayMigrate"
