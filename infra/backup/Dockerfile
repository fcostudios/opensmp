FROM postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777

# Verified against the pinned Postgres 16.14 Alpine 3.24 manifest above.
# `minisign` signs manifests with an Ed25519 secret that is mounted only for
# the backup invocation; `util-linux` supplies cross-container flock and Perl
# provides the O_NOFOLLOW descriptor copy used by restore staging.
RUN apk add --no-cache \
    age=1.3.1-r5 \
    bash=5.3.9-r1 \
    coreutils=9.11-r0 \
    minisign=0.12-r2 \
    perl=5.42.2-r0 \
    util-linux=2.42.1-r0

COPY --chown=postgres:postgres scripts/backup-common.sh /usr/local/bin/backup-common.sh
COPY --chown=postgres:postgres scripts/backup-db.sh /usr/local/bin/backup-db.sh
COPY --chown=postgres:postgres scripts/restore-db.sh /usr/local/bin/restore-db.sh
RUN chmod 0555 /usr/local/bin/backup-common.sh /usr/local/bin/backup-db.sh /usr/local/bin/restore-db.sh \
  && mkdir --parents /backups \
  && chown postgres:postgres /backups

# The backup job needs only the public age recipient supplied at runtime.
USER postgres
VOLUME ["/backups"]
ENTRYPOINT ["/usr/local/bin/backup-db.sh"]
