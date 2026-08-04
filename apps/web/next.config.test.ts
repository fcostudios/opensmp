import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";
import vitestConfig from "./vitest.config";

describe("Next webpack workspace resolution", () => {
  it("preserves existing resolution while mapping NodeNext .js specifiers to TS source", () => {
    expect(typeof nextConfig.webpack).toBe("function");
    const webpackConfig = {
      context: fileURLToPath(new URL(".", import.meta.url)),
      resolve: {
        alias: { existing: "/existing/module.ts" },
        extensionAlias: { ".mjs": [".mts", ".mjs"] },
      },
    };

    const result = nextConfig.webpack!(webpackConfig as never, {} as never);

    expect(result).toBe(webpackConfig);
    expect(result.resolve.alias.existing).toBe("/existing/module.ts");
    expect(result.resolve.extensionAlias).toEqual({
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    });
  });

  it("keeps this adjacent contract test in the web test project", () => {
    expect(vitestConfig.test?.include).toContain("next.config.test.ts");
  });
});
