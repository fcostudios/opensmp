import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  // Generated / build artifacts — not hand-authored, never lint them.
  { ignores: [".next/**", "node_modules/**", "public/**", "src/db/migrations/**", "scripts/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
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
