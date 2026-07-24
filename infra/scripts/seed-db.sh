#!/usr/bin/env bash
set -euo pipefail

echo "=== Seeding development database ==="
docker exec -i app-postgres psql -U app -d app < packages/db/seed/V999__dev_seed.sql
echo "Done."
