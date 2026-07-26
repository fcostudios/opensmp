#!/usr/bin/env bash
set -euo pipefail

echo "=== Ledger — Setup ==="

# 1. Install dependencies (pnpm workspace install at root).
#    First run writes pnpm-lock.yaml (repo root); commit it so installs are reproducible
#    (CI can then use `pnpm install --frozen-lockfile`). It is not gitignored.
echo "[1/3] Installing dependencies..."
pnpm install

# 2. Provision the database schema. DATABASE_URL drives the driver
#    (IMP-259): a standard Postgres URL applies locally via node-postgres;
#    a *.neon.tech URL targets managed Neon. A clean clone only ships
#    .env.example; without a .env.local, drizzle-kit reads no DATABASE_URL
#    and the push silently no-ops (IMP-256). Create the env file once, then
#    push (and verify it actually applied) only if it's set.
echo "[2/3] Provisioning database schema..."
cd packages/db
if [ ! -f .env.local ] && [ -f .env.example ]; then
  cp .env.example .env.local
  echo "  Created .env.local from .env.example (under packages/db)."
fi
if grep -Eq '^DATABASE_URL=.+' .env.local 2>/dev/null; then
  # push exits 0 even on an unreachable URL (silent no-op), so verify the
  # schema actually applied — fail loud on 0 tables (IMP-259).
  pnpm drizzle-kit push
  node scripts/verify-schema.mjs
else
  echo "  SKIPPED: set DATABASE_URL in the packages/db .env.local file first"
  echo "  (managed Postgres, e.g. Neon — no local Docker Postgres), then re-run."
fi
cd ../..

# 3. Validate the local Compose definition when Docker is available.
echo "[3/3] Validating Docker Compose runtime..."
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "  Created .env from .env.example; replace development values before deployment."
fi
docker compose -f infra/docker-compose.yml config >/dev/null
echo "=== Setup complete. Run infra/scripts/run-all.sh to start the stack. ==="
