import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ["src/**/*.{test,spec}.ts"],
    testTimeout: 120_000,
  },
});
