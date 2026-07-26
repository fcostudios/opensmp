import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "auth.spec.ts",
  globalSetup: "./e2e/auth.setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "http://localhost:3104",
    trace: "retain-on-failure",
  },
});
