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
    sequence: {
      seed: 7007,
      shuffle: {
        tests: true,
      },
    },
    include: [
      "src/modules/org-registry/go-live-operator.test.ts",
      "src/modules/org-registry/register-backfill.integration.test.ts",
      "src/modules/vendor-catalog/credential-crypto.test.ts",
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
