#!/usr/bin/env bash
# Copies and authenticates public restore artifacts before restore authority is
# enabled. Only encrypted/public material is written to RESTORE_STAGING_ROOT.
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

[[ "$#" -eq 1 && "$1" != -* ]] || fail 'usage: stage-restore-inputs.sh /path/to/ledger-YYYYMMDDHHMMSS.dump.age'
source_backup="$1"
[[ "$(basename -- "$source_backup")" =~ ^ledger-[0-9]{14}\.dump\.age$ ]] || fail 'backup file name must be ledger-YYYYMMDDHHMMSS.dump.age'
source_checksum="${source_backup}.sha256"
source_manifest="${source_backup}.manifest"
source_signature="${source_manifest}.minisig"
require_environment BACKUP_VERIFY_KEY_FILE
require_environment RESTORE_STAGING_ROOT
require_regular_file 'backup file' "$source_backup"
require_regular_file 'backup checksum metadata' "$source_checksum"
require_regular_file 'backup manifest' "$source_manifest"
require_regular_file 'backup manifest signature' "$source_signature"
require_regular_file BACKUP_VERIFY_KEY_FILE "$BACKUP_VERIFY_KEY_FILE"

[[ "$RESTORE_STAGING_ROOT" == /* ]] || fail 'RESTORE_STAGING_ROOT must be absolute'
validate_staging_root_identity() {
  if [[ -n "${RESTORE_STAGING_ROOT_FD:-}" ]]; then
    perl -e '
      my ($fd, $expected) = @ARGV;
      open(my $root, "<&$fd") or die "open pinned RESTORE_STAGING_ROOT: $!\n";
      my @st = stat($root);
      die "pinned RESTORE_STAGING_ROOT metadata changed\n"
        unless @st && -d _ && $st[4] == $> && ($st[2] & 0777) == 0700;
      open(my $info, "<", "/proc/self/fdinfo/$fd") or die "read staging fdinfo: $!\n";
      my $mnt = "";
      while (my $line = <$info>) {
        $mnt = $1 if $line =~ /^mnt_id:\s+([0-9]+)\s*$/;
      }
      die "pinned RESTORE_STAGING_ROOT identity changed\n"
        unless "$st[0]|$st[1]|$mnt" eq $expected;
    ' "$RESTORE_STAGING_ROOT_FD" "${RESTORE_STAGING_ROOT_ID:-}"
  else
    perl -e '
      my ($root) = @ARGV;
      my @st = lstat($root);
      die "RESTORE_STAGING_ROOT must be a private non-symlink directory\n"
        unless @st && -d _ && !-l _ && $st[4] == $> && ($st[2] & 0777) == 0700;
    ' "$RESTORE_STAGING_ROOT"
  fi
}
validate_staging_root_identity

filesystem_type=''
if filesystem_type="$(stat -f -c %T "$RESTORE_STAGING_ROOT" 2>/dev/null)"; then
  :
elif filesystem_type="$(stat -f %T "$RESTORE_STAGING_ROOT" 2>/dev/null)"; then
  :
else
  fail 'could not identify RESTORE_STAGING_ROOT filesystem'
fi
[[ "$filesystem_type" != overlay && "$filesystem_type" != overlayfs && "$filesystem_type" != aufs ]] \
  || fail 'RESTORE_STAGING_ROOT must be an explicit mount, not the container writable layer'

artifact_size() {
  perl -MFcntl=':DEFAULT,O_NOFOLLOW' -e '
    sysopen(my $in, $ARGV[0], O_RDONLY | O_NOFOLLOW) or die "open artifact: $!\n";
    my @st = stat($in);
    die "artifact is not a regular file\n" unless @st && -f _;
    print "$st[7]\n";
  ' "$1"
}

required_bytes=0
for artifact in "$source_backup" "$source_checksum" "$source_manifest" "$source_signature" "$BACKUP_VERIFY_KEY_FILE"; do
  artifact_bytes="$(artifact_size "$artifact")"
  [[ "$artifact_bytes" =~ ^[0-9]+$ ]] || fail 'could not determine restore artifact size'
  required_bytes="$(perl -MMath::BigInt -e '
    my ($total, $next) = map { Math::BigInt->new($_) } @ARGV;
    print $total->badd($next), "\n";
  ' "$required_bytes" "$artifact_bytes")"
done
available_kib="$(df -Pk "$RESTORE_STAGING_ROOT" | awk 'NR == 2 {print $4}')"
[[ "$available_kib" =~ ^[0-9]+$ ]] || fail 'could not determine RESTORE_STAGING_ROOT capacity'
# Keep one complete-copy margin plus 64 MiB for filesystem metadata/runtime
# scratch. This is checked before any copy or authority change.
perl -MMath::BigInt -e '
  my ($available_kib, $required) = map { Math::BigInt->new($_) } @ARGV;
  my $available = $available_kib->bmul(1024);
  my $minimum = $required->bmul(2)->badd(67108864);
  exit($available->bcmp($minimum) >= 0 ? 0 : 1);
' "$available_kib" "$required_bytes" \
  || fail 'RESTORE_STAGING_ROOT has insufficient verified-artifact capacity'

staged_dir="$(mktemp -d "$RESTORE_STAGING_ROOT/ledger-restore-inputs.XXXXXX")"
chmod 0700 "$staged_dir"
stage_succeeded=0
cleanup_stage_failure() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$stage_succeeded" != 1 && -d "$staged_dir" ]]; then
    chmod 0700 "$staged_dir"
    rm -rf -- "$staged_dir"
  fi
  exit "$status"
}
trap cleanup_stage_failure EXIT INT TERM

staged_backup="$staged_dir/$(basename -- "$source_backup")"
staged_checksum="${staged_backup}.sha256"
staged_manifest="${staged_backup}.manifest"
staged_signature="${staged_manifest}.minisig"
staged_verify_key="$staged_dir/verify.pub"
secure_copy_regular "$source_backup" "$staged_backup"
secure_copy_regular "$source_checksum" "$staged_checksum"
secure_copy_regular "$source_manifest" "$staged_manifest"
secure_copy_regular "$source_signature" "$staged_signature"
secure_copy_regular "$BACKUP_VERIFY_KEY_FILE" "$staged_verify_key"

expected_filename="$(basename "$staged_backup")"
expected_checksum="$(awk '{print $1}' "$staged_checksum")"
[[ "$expected_checksum" =~ ^[a-f0-9]{64}$ ]] || fail 'backup checksum metadata is invalid'
[[ "$(wc -l < "$staged_checksum" | tr -d ' ')" == 1 && "$(< "$staged_checksum")" == "$expected_checksum  $expected_filename" ]] \
  || fail 'backup checksum metadata is invalid'
[[ "$(sha256_file "$staged_backup")" == "$expected_checksum" ]] || fail 'backup checksum verification failed'
minisign -Vm "$staged_manifest" -p "$staged_verify_key" -x "$staged_signature" -q >/dev/null

manifest_lines=()
while IFS= read -r manifest_line || [[ -n "$manifest_line" ]]; do
  manifest_lines+=("$manifest_line")
done < "$staged_manifest"
[[ "${#manifest_lines[@]}" == 6 ]] || fail 'backup manifest is invalid'
[[ "${manifest_lines[0]}" == 'format_version=1' ]] || fail 'backup manifest format version is unsupported'
[[ "${manifest_lines[1]}" == "basename=$expected_filename" ]] || fail 'backup manifest basename does not match ciphertext'
[[ "${manifest_lines[2]}" == "ciphertext_sha256=$expected_checksum" ]] || fail 'backup manifest checksum does not match ciphertext'
manifest_size="${manifest_lines[3]#ciphertext_size=}"
[[ "${manifest_lines[3]}" == "ciphertext_size=$manifest_size" && "$manifest_size" =~ ^[0-9]+$ ]] || fail 'backup manifest size is invalid'
[[ "$manifest_size" == "$(artifact_size "$staged_backup")" ]] || fail 'backup manifest size does not match ciphertext'
[[ "${manifest_lines[4]}" =~ ^created_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail 'backup manifest timestamp is invalid'
[[ "${manifest_lines[5]}" =~ ^source_system_identifier=[0-9]+$ ]] || fail 'backup manifest source system identifier is invalid'

chmod 0400 "$staged_backup" "$staged_checksum" "$staged_manifest" "$staged_signature" "$staged_verify_key"
chmod 0500 "$staged_dir"
validate_staging_root_identity
stage_succeeded=1
trap - EXIT INT TERM
printf '%s\n' "$staged_backup"
