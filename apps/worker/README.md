# Ledger worker

The worker runs the pg-boss schedules with UTC as the stored execution time.
America/Guayaquil is UTC-5 year-round (mainland Ecuador; Galápagos is out of
scope), so operators can use these local equivalents when checking a run:

| Job | UTC cron | America/Guayaquil cron |
| --- | --- | --- |
| Analytics sync | `15 10 * * *` | `15 5 * * *` |
| Member sync | `5 * * * *` | `5 * * * *` |
| Invite polling | `*/15 * * * *` | `*/15 * * * *` |
| Alert evaluation | `7,22,37,52 * * * *` | `7,22,37,52 * * * *` |
| Close precheck | `30 10 * * 1-5` | `30 5 * * 1-5` |

Lifecycle email delivery is a separate durable outbox drain, not a pg-boss
business queue. It runs immediately after worker startup and every 60 seconds,
claims at most 100 ready messages per pass, and never overlaps a previous pass.
`LEDGER_PUBLIC_URL` supplies server-owned request links and `SMTP_URL` supplies
the relay. Delivery failures remain journaled for bounded retry; revoked or
disabled recipients are terminally suppressed.

## Close-precheck calendar

`ECUADOR_HOLIDAYS` is required configuration. The deployment operator owns its
annual refresh and must supply a comma-separated list of actual mainland
Ecuador public holidays in `YYYY-MM-DD` form. Do not copy an example or reuse
a prior-year list: maintain the authoritative holiday dates for the deployment
year in the deployment secret.

The worker validates every date before it opens the runtime. A blank,
whitespace-only, or invalid value stops startup deliberately; it must not
guess the third business day or run a close precheck using an empty calendar.
Docker Compose passes this value through to the worker, so set it in the
deployment secret or `.env` before bringing the service up.

## Readiness

The worker has no HTTP server and no file heartbeat. On startup it creates the
five non-partitioned queues, registers their workers, reconciles their
schedules, asks pg-boss to supervise them, and starts the lifecycle outbox
drain before reporting ready. It then writes an instance-scoped row to
`pgboss.worker_runtime_health`.

The Compose healthcheck resolves the current container's instance ID and
requires that exact row to remain `healthy`, `scheduler_ready`, registered with
all five workers, and freshly heartbeating. A pg-boss background error latches
the instance unhealthy and triggers bounded fatal shutdown even if PostgreSQL
cannot accept the unhealthy-state write; Docker can then restart the failed
process. Another worker's queue supervision cannot mask this instance's
failure.
