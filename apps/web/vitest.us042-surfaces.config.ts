import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoot = resolve(import.meta.dirname, "../..");

export default defineConfig({
  root: workspaceRoot,
  resolve: {
    alias: [
      {
        find: "@smp/domain/alerts",
        replacement: resolve(
          workspaceRoot,
          "packages/domain/src/alerts/evaluate.ts",
        ),
      },
      {
        find: /^@smp\/ui$/,
        replacement: resolve(workspaceRoot, "packages/ui/src/index.ts"),
      },
      {
        find: "@",
        replacement: resolve(workspaceRoot, "apps/web/src"),
      },
    ],
  },
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120_000,
    include: [
      "apps/web/src/components/alerts/alert-list.test.tsx",
      "apps/web/src/components/alerts/alert-page-boundaries.test.ts",
      "apps/web/src/components/exceptions/blocked-requests-table.test.tsx",
      "apps/web/src/components/exceptions/exception-page-boundaries.test.ts",
      "apps/web/src/components/requests/checklist-exceptions-list.test.tsx",
      "apps/web/src/modules/operational-alert-read.integration.test.ts",
      "apps/web/src/modules/alerts/repository.integration.test.ts",
      "apps/web/src/modules/request-workflow/orchestration.integration.test.ts",
      "apps/web/src/modules/request-workflow/read-repository.integration.test.ts",
      "packages/ui/src/organisms/alert-list.test.tsx",
    ],
    testTimeout: 120_000,
  },
});
