// Shared ESLint flat-config preset for the workspace.
const providerNeutralCoreBoundary = {
  files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  ignores: [
    "packages/connectors/src/providers/**",
    "scripts/probes/**",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "*anthropic*",
              "*claude*",
              "**/*anthropic*",
              "**/*claude*",
              "**/providers/anthropic",
              "**/providers/anthropic/**",
            ],
            caseSensitive: false,
            message:
              "Core code must use the vendor-neutral @smp/connectors interface.",
          },
        ],
      },
    ],
    "no-restricted-modules": [
      "error",
      {
        patterns: [
          "*anthropic*",
          "*claude*",
          "*Anthropic*",
          "*Claude*",
          "**/*anthropic*",
          "**/*claude*",
          "**/*Anthropic*",
          "**/*Claude*",
          "**/providers/anthropic",
          "**/providers/anthropic/**",
        ],
      },
    ],
  },
};

export default [providerNeutralCoreBoundary];
