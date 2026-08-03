const config = {
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "scripts/probes/anthropic/pact.contract.test.ts",
      "apps/web/src/modules/identity-access/keycloak-admin.pact.test.ts",
    ],
    testTimeout: 30_000,
  },
};

export default config;
