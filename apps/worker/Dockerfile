FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @smp/worker...

FROM dependencies AS build
COPY apps/worker apps/worker
RUN pnpm --filter @smp/worker build && pnpm --filter @smp/worker --prod deploy /app/runtime

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 ledger && adduser --system --uid 1001 --ingroup ledger ledger
COPY --from=build --chown=ledger:ledger /app/runtime ./
USER ledger
CMD ["node", "dist/index.js"]
