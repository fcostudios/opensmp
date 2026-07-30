const config = {
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["scripts/probes/anthropic/pact.contract.test.ts"],
    testTimeout: 30_000,
  },
};

export default config;
