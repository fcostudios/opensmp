#!/usr/bin/env bash
# launchd runs this with operator-owned paths supplied as environment variables.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
bash infra/backup/run-cron.sh
