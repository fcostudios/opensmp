FROM node:22-alpine AS dependencies
# CHG-120: Corepack/pnpm under Node 22 give each registry address 250 ms to connect; slow Docker Desktop VMs need more. Build-time only (ARG, not ENV).
ARG NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/notifications/package.json packages/notifications/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=ledger-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

FROM dependencies AS build
# CHG-120: Corepack/pnpm under Node 22 give each registry address 250 ms to connect; slow Docker Desktop VMs need more. Build-time only (ARG, not ENV).
ARG NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000
COPY . .
RUN pnpm --filter smp-web build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 ledger && adduser --system --uid 1001 --ingroup ledger ledger
COPY --from=build --chown=ledger:ledger /app/apps/web/.next/standalone ./
COPY --from=build --chown=ledger:ledger /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=ledger:ledger /app/apps/web/public ./apps/web/public
# US-048: offline-readable operations docs, available without identity login.
COPY --chown=ledger:ledger docs/runbooks/ ./apps/web/public/auth/operations/
COPY --chown=ledger:ledger docs/evidence/us-048/ ./apps/web/public/auth/evidence/us-048/
USER ledger
CMD ["node", "apps/web/server.js"]
