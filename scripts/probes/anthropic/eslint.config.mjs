import webConfig from "../../../apps/web/eslint.config.mjs";

const probeConfig = [
  ...webConfig,
  {
    files: ["**/*.{ts,mjs}"],
    settings: {
      react: {
        version: "19.2.0",
      },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default probeConfig;
