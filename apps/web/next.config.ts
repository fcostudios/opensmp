import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // PDFKit loads its bundled AFM data relative to its package at runtime.
  serverExternalPackages: ["pdfkit"],
  experimental: {
    authInterrupts: true,
    serverActions: { bodySizeLimit: "2mb" },
  },
  // This repository explicitly builds with `next build --webpack`. Preserve
  // NodeNext-correct `.js` source specifiers while resolving workspace TS.
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    if (isServer) {
      // Next defaults URL dependencies to browser-relative URLs. Node's fs
      // needs a real file URL anchored at the emitted webpack runtime.
      config.module.rules.push({
        test: /[\\/]modules[\\/]statements[\\/]pdf[\\/]render\.ts$/,
        parser: { url: true },
      }, {
        test: /[\\/]fonts[\\/]statement[\\/].*\.ttf$/,
        type: "asset/resource",
        generator: { publicPath: "./" },
      });
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
