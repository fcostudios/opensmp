import { defineConfig } from "./apps/web/node_modules/vitest/dist/config.js";

export default defineConfig({
  test: {
    projects: [
      "apps/web/vitest.config.ts",
      "packages/contracts/vitest.config.ts",
      "packages/db/vitest.config.ts",
    ],
  },
});
