import { beforeEach, expect, test, vi } from "vitest";
let statementFiltersSchema: typeof import("./statements").statementFiltersSchema;
beforeEach(async()=>{vi.resetModules();statementFiltersSchema=(await import("./statements")).statementFiltersSchema;});

test("statement read filters accept every persisted status and reject invalid or extra scope claims", () => {
  for (const status of ["draft", "final", "reconciled"]) {
    expect(statementFiltersSchema.parse({period:"2026-01",status})).toEqual({period:"2026-01",status});
  }
  for (const input of [{},{period:"2026-00"},{period:"2026-13"},{period:"2026-01",status:""},{period:"2026-01",status:"unknown"},{period:"2026-01",companyId:"bad"},{period:"2026-01",companyIds:[]}]) {
    expect(statementFiltersSchema.safeParse(input).success).toBe(false);
  }
  expect(statementFiltersSchema.parse({period:"2026-01",companyId:"96000000-0000-4000-8000-000000000002"})).toEqual({period:"2026-01",companyId:"96000000-0000-4000-8000-000000000002"});
});
