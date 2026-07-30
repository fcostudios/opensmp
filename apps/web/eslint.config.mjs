import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import sharedPreset from "../../packages/config/eslint-preset.mjs";

const providerRestrictedImports =
  sharedPreset[0].rules["no-restricted-imports"];
const providerRestrictedPatterns =
  providerRestrictedImports[1].patterns;

const eslintConfig = [
  // Generated / build artifacts — not hand-authored, never lint them.
  { ignores: [".next/**", "node_modules/**", "public/**", "src/db/migrations/**"] },
  ...sharedPreset,
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // Intentionally-unused stub args/vars use a leading underscore.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Empty prop interfaces (extends a supertype) are an intentional React pattern.
      "@typescript-eslint/no-empty-object-type": "off",
      // tailwind.config.ts deliberately uses `@ts-ignore` (not
      // `@ts-expect-error`, which TS2578-errors when the JS preset import
      // resolves cleanly — IMP-248). Allow it.
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@smp/db",
              message:
                "Company data access belongs in repositories or transaction services.",
            },
          ],
          patterns: [
            {
              group: ["@smp/db/*"],
              message:
                "Company data access belongs in repositories or transaction services.",
            },
            ...providerRestrictedPatterns,
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.spec.{ts,tsx}",
      "src/modules/**/repository.ts",
      "src/modules/**/*-transaction.ts",
      "src/app/api/health/route.ts",
      "src/app/api/health/health.ts",
      "src/lib/auth/auth-config.ts",
      "src/modules/identity-access/session.ts",
      "src/modules/identity-access/authorization.ts",
      "src/modules/identity-access/server-authorization.ts",
      "src/modules/identity-access/locale.ts",
      "src/modules/audit/auth-events.ts",
      "src/modules/audit/queries.ts",
      "src/modules/audit/with-audit.ts",
    ],
    rules: {
      // These files are exempt from direct DB import restrictions, but remain
      // vendor-neutral and therefore keep the shared provider boundary.
      "no-restricted-imports": providerRestrictedImports,
    },
  },
];

export default eslintConfig;
