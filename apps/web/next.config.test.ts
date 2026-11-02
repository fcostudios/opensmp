import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

let nextConfig: typeof import("./next.config").default;
let vitestConfig: typeof import("./vitest.config").default;

describe("Next webpack workspace resolution", () => {
  beforeEach(async () => {
    vi.resetModules();
    nextConfig = (await import("./next.config")).default;
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

  it("packages statement fonts as Node file URLs and keeps PDFKit runtime data", () => {
    expect(nextConfig.serverExternalPackages).toContain("pdfkit");
    const config = { context: fileURLToPath(new URL(".", import.meta.url)), resolve: {}, module: { rules: [] as Array<{test: RegExp; type?: string; parser?: {url: boolean}; generator?: {publicPath: string}}> } };
    nextConfig.webpack!(config as never, { isServer: true } as never);
    const renderer = config.module.rules.find(rule => rule.test.test("/app/src/modules/statements/pdf/render.ts"));
    const font = config.module.rules.find(rule => rule.test.test("/app/public/fonts/statement/Barlow-Regular.ttf"));
    expect(renderer?.parser?.url).toBe(true);
    expect(font?.type).toBe("asset/resource");
    // webpack's Node runtime anchors assets at .next/server/chunks/.
    expect(new URL(font!.generator!.publicPath + "static/media/Barlow.ttf", "file:///deploy/.next/server/chunks/").pathname).toBe("/deploy/.next/server/chunks/static/media/Barlow.ttf");
    for (const filename of [
      "/app/src/modules/other/render.ts",
      "/app/src/premodules/statements/pdf/render.ts",
      "/app/src/modules/statements/pdf/prerender.ts",
      "/app/src/modules/statements/pdf/render.tsx",
      "/app/src/modules/statements/pdf/render.ts.backup",
    ]) expect(renderer!.test.test(filename)).toBe(false);
    for (const filename of [
      "/app/public/fonts/prestatement/Barlow-Regular.ttf",
      "/app/public/fonts/statement-backup/Barlow-Regular.ttf",
      "/app/public/fonts/statement/Barlow-Regular.ttf.bak",
      "/app/public/fonts/statement/Barlow-Regular.ttf.js",
    ]) expect(font!.test.test(filename)).toBe(false);
    const browser = { context: fileURLToPath(new URL(".", import.meta.url)), resolve: {}, module: { rules: [] } };
    nextConfig.webpack!(browser as never, { isServer: false } as never);
    expect(browser.module.rules).toEqual([]);
  });

  it("keeps this adjacent contract test in the web test project", () => {
    expect(nextConfig.experimental?.authInterrupts).toBe(true);
    expect(vitestConfig.test?.include).toEqual([
      "src/**/*.{test,spec}.{ts,tsx}",
      "next.config.test.ts",
    ]);
  });
});
