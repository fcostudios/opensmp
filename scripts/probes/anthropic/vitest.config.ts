const config = {
  test: {
    environment: "node",
    exclude: ["scripts/probes/anthropic/**/*.contract.test.ts"],
    include: ["scripts/probes/anthropic/**/*.test.ts"],
  },
};

export default config;
