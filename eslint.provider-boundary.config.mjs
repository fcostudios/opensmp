import typescriptParser from "@typescript-eslint/parser";

import sharedPreset from "./packages/config/eslint-preset.mjs";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "apps/web/public/**",
      "packages/db/src/migrations/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: typescriptParser,
    },
  },
  ...sharedPreset,
];
