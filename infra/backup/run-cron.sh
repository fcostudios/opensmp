#!/usr/bin/env bash
# Preserve Docker's status even though its operator-visible output is sent to
# journald. Called by cron with CRON_TZ=UTC from the repository directory.
set -euo pipefail

docker compose -f infra/docker-compose.yml --profile backup run --rm backup 2>&1 | logger -t ledger-backup
