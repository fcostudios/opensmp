const config = {
  // Gate the full probe safety boundary: provider identity binding,
  // mutation/checkpoint orchestration, outcome/exit classification, durable
  // atomic writes, schema validation, and evidence redaction.
  mutate: [
    // The full safety implementation is gated; only the import.meta
    // direct-invocation launcher below line 840 is environment wiring.
    "probe.ts:107:0-840:0",
    "runtime.ts:50:0-137:1",
    "redact.ts",
    "schemas.ts",
  ],
  plugins: [
    "../../../node_modules/@stryker-mutator/vitest-runner/dist/src/index.js",
  ],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.mutation.config.ts",
    related: false,
  },
  // Run every exact boundary oracle against each mutant. Per-test coverage can
  // under-select tests whose injected filesystem dependencies throw before a
  // later source location is reached in the dry run.
  coverageAnalysis: "all",
  concurrency: 4,
  reporters: ["clear-text", "progress", "json"],
  thresholds: {
    high: 90,
    low: 80,
    break: 80,
  },
  tempDirName: ".stryker-tmp",
};

export default config;
