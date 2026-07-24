#!/usr/bin/env bash
set -euo pipefail

echo "=== Resetting database schema ==="
# Drop + re-push the Drizzle schema against the managed Postgres.
# (No Docker Postgres to recreate — the database is managed, e.g. Neon.)
cd packages/db && pnpm drizzle-kit push --force
echo "Schema reset. Run 'infra/scripts/seed-db.sh' to reseed."
