import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoot = resolve(import.meta.dirname, "../..");

export default defineConfig({
  root: workspaceRoot,
  resolve: {
    alias: [
      {
        find: "@",
        replacement: resolve(workspaceRoot, "apps/web/src"),
      },
    ],
  },
  test: {
    environment: "node",
    include: [
      "apps/web/src/modules/request-workflow/orchestration.integration.test.ts",
      "apps/web/src/modules/request-workflow/orchestration-contract.test.ts",
      "apps/web/src/modules/request-workflow/approval-repository.integration.test.ts",
      "apps/web/src/modules/request-workflow/member-sync-checklist-observation.test.ts",
      "apps/web/src/modules/request-workflow/actions/checklist-action-transaction.test.ts",
      "apps/web/src/components/requests/checklist-controller.test.ts",
      "apps/web/src/components/requests/checklist-exception-presenter.test.ts",
      "apps/web/src/components/requests/checklist-panel.test.tsx",
      "apps/web/src/components/requests/checklist-exceptions-list.test.tsx",
    ],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
