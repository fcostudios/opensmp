import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoot = process.cwd();

export default defineConfig({
  root: workspaceRoot,
  resolve: {
    alias: [
      {
        find: "@smp/contracts/requests",
        replacement: resolve(
          workspaceRoot,
          "packages/contracts/src/requests.ts",
        ),
      },
      {
        find: /^@smp\/contracts$/,
        replacement: resolve(workspaceRoot, "packages/contracts/src/index.ts"),
      },
      {
        find: "@smp/domain/identity-access",
        replacement: resolve(
          workspaceRoot,
          "packages/domain/src/identity-access/authorization.ts",
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
        find: "@",
        replacement: resolve(workspaceRoot, "apps/web/src"),
      },
    ],
  },
  test: {
    environment: "node",
    include: [
      "packages/contracts/src/requests.test.ts",
      "apps/web/src/components/requests/domain-suggestion.test.ts",
      "apps/web/src/components/requests/request-detail-feedback.test.tsx",
      "apps/web/src/components/requests/request-submission-client.test.ts",
      "apps/web/src/components/requests/request-submission-controller.integration.test.tsx",
      "apps/web/src/modules/request-workflow/budget-math.test.ts",
      "apps/web/src/modules/request-workflow/repository.integration.test.ts",
    ],
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
