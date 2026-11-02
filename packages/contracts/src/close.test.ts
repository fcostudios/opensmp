import { beforeEach, expect, test, vi } from "vitest";
let runCloseSchema: typeof import("./close").runCloseSchema;
beforeEach(async()=>{vi.resetModules();runCloseSchema=(await import("./close")).runCloseSchema;});
test("close accepts canonical months and bounded notes, rejects untrusted scope and malformed commands",()=>{
  expect(runCloseSchema.parse({period:"2026-01",note:"  correction  "})).toEqual({period:"2026-01",note:"correction"});
  expect(runCloseSchema.parse({period:"2026-12"})).toEqual({period:"2026-12",note:null});
  for(const input of [{period:"2026-00"},{period:"2026-13"},{period:"2026-1"},{period:"0000-01"},{period:"2026-01junk"},{period:"junk2026-01"},{period:"2026-01",companyId:"foreign"},{period:"2026-01",note:"x".repeat(2001)},{}]) expect(runCloseSchema.safeParse(input).success).toBe(false);
  expect(runCloseSchema.parse({period:"2026-01",note:"x".repeat(2000)}).note).toHaveLength(2000);
});
