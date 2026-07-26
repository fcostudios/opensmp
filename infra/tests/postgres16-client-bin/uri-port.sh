#!/usr/bin/env bash
# Maps the host-published fixture URI to the PostgreSQL port inside its
# container. Production scripts retain the original URI and are not altered.
set -euo pipefail

map_fixture_dbname_arg() {
  local host_port="$1"
  local arg="$2"
  printf '%s\n' "${arg/:${host_port}\//:5432/}"
}
