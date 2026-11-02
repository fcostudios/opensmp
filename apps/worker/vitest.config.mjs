import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@smp/db/license-close": fileURLToPath(new URL("../../packages/db/src/license-close.ts", import.meta.url)) } },
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ["src/**/*.{test,spec}.ts"],
    testTimeout: 120_000,
  },
});
