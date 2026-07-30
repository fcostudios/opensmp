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
    fileParallelism: false,
    hookTimeout: 120_000,
    include: [
      "apps/web/src/modules/request-workflow/read-repository.integration.test.ts",
      "apps/web/src/modules/request-workflow/request-detail-decision-policy.test.ts",
    ],
    testTimeout: 120_000,
  },
});
