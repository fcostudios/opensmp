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
    include: [
      "packages/notifications/src/catalog.test.ts",
      "packages/notifications/src/mailer.test.ts",
      "packages/notifications/src/mailer.integration.test.ts",
      "apps/worker/src/lifecycle-notification-drain.test.ts",
      "apps/worker/src/runtime.integration.test.ts",
      "apps/web/src/lib/i18n/catalogs.test.ts",
      "apps/web/src/lib/i18n/messages.test.ts",
      "apps/web/src/app/(authenticated)/aprobaciones/approval-target.test.ts",
      "apps/web/src/components/requests/approval-queue.test.tsx",
      "apps/web/src/modules/audit/with-audit.integration.test.ts",
      "apps/web/src/modules/request-workflow/lifecycle-notifications.integration.test.ts",
      "apps/web/src/modules/request-workflow/repository.integration.test.ts",
      "apps/web/src/modules/request-workflow/approval-repository.integration.test.ts",
      "apps/web/src/modules/request-workflow/orchestration.integration.test.ts",
    ],
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
