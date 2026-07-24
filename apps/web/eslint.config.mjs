import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  // Generated / build artifacts — not hand-authored, never lint them.
  { ignores: [".next/**", "node_modules/**", "public/**", "src/db/migrations/**", "scripts/**"] },
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
];

export default eslintConfig;
