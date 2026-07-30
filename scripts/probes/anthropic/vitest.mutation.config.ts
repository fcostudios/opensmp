import { fileURLToPath } from "node:url";

const config = {
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    exclude: ["**/*.contract.test.ts"],
    include: ["probe.test.ts"],
  },
};

export default config;
