import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("loads the real Barlow Condensed 900 display face", () => {
  const source = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

  expect(source).toContain(
    "Barlow+Condensed:wght@400;500;600;700;900",
  );
});
