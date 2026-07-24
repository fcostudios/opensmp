import type { Config } from "tailwindcss";
// IMP-269 — INERT under Tailwind v4. Tokens come from `src/styles/tokens.css`
// (`@theme`, imported by globals.css); this config is NOT auto-loaded (no
// `@config` directive), so it is a v4 compat stub kept for tooling/editors.
// Editing it does not change the build (IMP-267 proved byte-identical CSS).
// IMP-248 — the design-system preset is plain JS with no .d.ts. Under the
// generated tsconfig the import resolves cleanly, so a `@ts-expect-error`
// was UNUSED (TS2578). `@ts-ignore` suppresses a declaration error on a
// stricter tsconfig WITHOUT erroring when there is nothing to suppress.
// @ts-ignore — JS preset, no type declarations
import smpPreset from "../../packages/design-system/tailwind-preset";

const config: Config = {
  presets: [smpPreset],
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
