FROM postgres:16-alpine

RUN apk add --no-cache age bash coreutils

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
