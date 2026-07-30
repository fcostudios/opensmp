import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@smp/notifications": fileURLToPath(
        new URL("../../packages/notifications/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    hookTimeout: 120_000,
    include: [
      "apps/web/src/modules/alerts/repository.integration.test.ts",
      "apps/worker/src/alerts/evaluate-alerts.integration.test.ts",
      "apps/worker/src/alerts/report-job-failure.integration.test.ts",
    ],
    testTimeout: 120_000,
  },
});
