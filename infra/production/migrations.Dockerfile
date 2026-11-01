FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @smp/db... --prod
COPY packages/db/scripts packages/db/scripts
COPY packages/db/schema-contract.json packages/db/schema-contract.json
COPY packages/db/src/migrations packages/db/src/migrations
COPY infra/production/migrate.mjs infra/production/migrate.mjs
USER node
WORKDIR /app/packages/db
# The runner supplies encoded owner/runtime URLs then executes:
# node scripts/apply-migrations.mjs && node scripts/verify-schema.mjs
CMD ["node", "/app/infra/production/migrate.mjs"]
