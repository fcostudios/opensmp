import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import nextConfig from "./next.config";

let vitestConfig: typeof import("./vitest.config").default;

describe("Next webpack workspace resolution", () => {
  beforeEach(async () => {
    vi.resetModules();
    vitestConfig = (await import("./vitest.config")).default;
  });

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
    expect(vitestConfig.test?.include).toEqual([
      "src/**/*.{test,spec}.{ts,tsx}",
      "next.config.test.ts",
    ]);
  });
});
