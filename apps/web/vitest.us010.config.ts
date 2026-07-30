import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: appRoot,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/modules/org-registry/repository.integration.test.ts",
    ],
    sequence: {
      seed: 1010,
      shuffle: { tests: true },
    },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
