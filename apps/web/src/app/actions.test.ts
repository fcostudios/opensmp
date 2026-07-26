import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { ping } from "./actions";

test("the root server-action entrypoint stays database-free", async () => {
  await expect(ping()).resolves.toEqual({ ok: true });

  const source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
  expect(source).not.toContain("@smp/db");
  expect(source).not.toContain("dbReachable");
});
