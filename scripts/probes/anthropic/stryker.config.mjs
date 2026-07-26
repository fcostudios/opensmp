const config = {
  // Gate the mutation-sensitive safety boundary: provider identity binding,
  // mutation/checkpoint orchestration, outcome/exit classification, and the
  // durable atomic writer. Broader schema/redaction behavior is covered by
  // the repository's existing mutation suite.
  mutate: [
    "probe.ts:384:0-605:1",
    "probe.ts:722:0-758:1",
    "runtime.ts:12:0-69:1",
  ],
  plugins: [
    "../../../node_modules/@stryker-mutator/vitest-runner/dist/src/index.js",
  ],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.mutation.config.ts",
    related: false,
  },
  coverageAnalysis: "perTest",
  concurrency: 4,
  reporters: ["clear-text", "progress"],
  thresholds: {
    high: 90,
    low: 80,
    break: 80,
  },
  tempDirName: "../../../.stryker-tmp/anthropic-probe",
};

export default config;
