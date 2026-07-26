import { expect, test } from "vitest";
import * as systemIds from "@smp/db/system-ids";
import * as contracts from "./index";

test("exports the deterministic system actor contract", () => {
  const exported = contracts as unknown as Record<string, string>;
  expect(exported.SYSTEM_USER_ID).toBe("00000000-0000-0000-0000-000000000001");
  expect(exported.SYSTEM_USER_EMAIL).toBe("system@ledger.invalid");
  expect(systemIds.SYSTEM_USER_ID).toBe(exported.SYSTEM_USER_ID);
  expect(systemIds.SYSTEM_USER_EMAIL).toBe(exported.SYSTEM_USER_EMAIL);
});
