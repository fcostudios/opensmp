import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoot = resolve(import.meta.dirname, "../..");

export default defineConfig({
  root: workspaceRoot,
  resolve: {
    alias: [{ find: "@", replacement: resolve(workspaceRoot, "apps/web/src") }],
  },
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120_000,
    include: [
      "packages/domain/src/alerts/approval-aging.test.ts",
      "packages/contracts/src/alerts.test.ts",
      "packages/notifications/src/catalog.test.ts",
      "packages/notifications/src/outbox.integration.test.ts",
      "apps/worker/src/alerts/approval-aging.integration.test.ts",
      "apps/worker/src/alerts/approval-aging-hardening.integration.test.ts",
      "apps/worker/src/alerts/evaluate-alerts.integration.test.ts",
      "apps/web/src/modules/alerts/repository.integration.test.ts",
    ],
    testTimeout: 120_000,
  },
});
