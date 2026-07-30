import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoot = process.cwd();

export default defineConfig({
  root: workspaceRoot,
  resolve: {
    alias: [
      {
        find: "@smp/domain/identity-access",
        replacement: resolve(
          workspaceRoot,
          "packages/domain/src/identity-access/authorization.ts",
        ),
      },
      {
        find: "@smp/domain/request-workflow/business-time",
        replacement: resolve(
          workspaceRoot,
          "packages/domain/src/request-workflow/business-time.ts",
        ),
      },
      {
        find: "@smp/domain/request-workflow",
        replacement: resolve(
          workspaceRoot,
          "packages/domain/src/request-workflow/lifecycle.ts",
        ),
      },
      {
        find: /^@smp\/contracts$/,
        replacement: resolve(
          workspaceRoot,
          "packages/contracts/src/index.ts",
        ),
      },
      {
        find: /^@smp\/domain$/,
        replacement: resolve(workspaceRoot, "packages/domain/src/index.ts"),
      },
      {
        find: "@",
        replacement: resolve(workspaceRoot, "apps/web/src"),
      },
    ],
  },
  test: {
    environment: "node",
    include: [
      "packages/contracts/src/request-workflow.test.ts",
      "packages/domain/src/request-workflow/business-time.test.ts",
      "packages/domain/src/request-workflow/lifecycle.test.ts",
      "apps/web/src/components/requests/approval-queue.test.tsx",
      "apps/web/src/components/requests/decision-settlement.test.ts",
      "apps/web/src/components/requests/decision-retry-focus.test.tsx",
      "apps/web/src/modules/request-workflow/approval/money.test.ts",
      "apps/web/src/modules/request-workflow/approval-repository.integration.test.ts",
    ],
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
