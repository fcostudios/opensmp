import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoot = process.cwd();

export default defineConfig({
  root: workspaceRoot,
  resolve: {
    alias: [
      {
        find: "@smp/domain/vendor-catalog/pool-math",
        replacement: resolve(
          workspaceRoot,
          "packages/domain/src/vendor-catalog/pool-math.ts",
        ),
      },
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
    include: [
      "packages/domain/src/vendor-catalog/pool-math.test.ts",
      "packages/connectors/src/action-planner.test.ts",
      "packages/domain/src/alerts/evaluate.test.ts",
      "packages/ui/src/organisms/pool-gauge.test.tsx",
      "apps/web/src/components/pools/pool-cards.test.tsx",
      "apps/web/src/components/pools/pool-tiles.test.tsx",
      "apps/web/src/modules/vendor-catalog/pool-repository.integration.test.ts",
      "apps/web/src/modules/vendor-catalog/cross-org-move.integration.test.ts",
      "apps/web/src/modules/org-registry/repository.integration.test.ts",
      "apps/web/src/modules/request-workflow/service.integration.test.ts",
      "apps/worker/src/alerts/evaluate-alerts.integration.test.ts",
    ],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
