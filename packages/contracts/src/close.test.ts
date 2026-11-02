import { beforeEach, expect, test, vi } from "vitest";
let runCloseSchema: typeof import("./close").runCloseSchema;
beforeEach(async()=>{vi.resetModules();runCloseSchema=(await import("./close")).runCloseSchema;});
test("close accepts canonical months and bounded notes, rejects untrusted scope and malformed commands",()=>{
  expect(runCloseSchema.parse({period:"2026-01",note:"  correction  "})).toEqual({period:"2026-01",note:"correction"});
  expect(runCloseSchema.parse({period:"2026-12"})).toEqual({period:"2026-12",note:null});
  for(const input of [{period:"2026-00"},{period:"2026-13"},{period:"2026-1"},{period:"0000-01"},{period:"2026-01junk"},{period:"junk2026-01"},{period:"2026-01",companyId:"foreign"},{period:"2026-01",note:"x".repeat(2001)},{}]) expect(runCloseSchema.safeParse(input).success).toBe(false);
  expect(runCloseSchema.parse({period:"2026-01",note:"x".repeat(2000)}).note).toHaveLength(2000);
});


test("finalization commands require literal confirmation and canonical period/id while rejecting forged scope",async()=>{
  const {finalizeStatementSchema:single,finalizeStatementsSchema:period}=await import("./close");
  const statementId="35000000-0000-4000-8000-000000000001";
  expect(period.parse({period:"2026-01",confirmed:true})).toEqual({period:"2026-01",confirmed:true});
  expect(single.parse({period:"2026-01",confirmed:true,statementId})).toEqual({period:"2026-01",confirmed:true,statementId});
  for(const confirmed of [undefined,false,"true",1]) {
    expect(period.safeParse({period:"2026-01",confirmed}).success).toBe(false);
    expect(single.safeParse({period:"2026-01",confirmed,statementId}).success).toBe(false);
  }
  for(const input of [{period:"2026-13",confirmed:true},{period:"2026-01",confirmed:true,companyId:statementId}]) expect(period.safeParse(input).success).toBe(false);
  for(const value of [undefined,"invalid",""]) expect(single.safeParse({period:"2026-01",confirmed:true,statementId:value}).success).toBe(false);
});
