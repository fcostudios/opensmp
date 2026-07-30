import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoot = process.cwd();
export default defineConfig({
  root: resolve(workspaceRoot, "apps/web"),
  resolve: {
    alias: {
      "@": resolve(workspaceRoot, "apps/web/src"),
      "@smp/contracts/register": resolve(workspaceRoot, "packages/contracts/src/register.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/modules/register/repository.integration.test.ts", "src/components/register/register-surface.test.tsx"],
    hookTimeout: 120000,
    testTimeout: 120000,
  },
});
