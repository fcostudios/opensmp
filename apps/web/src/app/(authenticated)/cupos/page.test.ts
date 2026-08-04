import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("US-023 pools page wiring", () => {
  it("binds the typed label composer to PoolCards", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain('import { createPoolCardsLabels } from "./labels";');
    expect(source).toContain("const labels = createPoolCardsLabels(t);");
    expect(source).toContain("labels={labels}");
  });
});
