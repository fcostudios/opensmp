import { expect, test } from "vitest";
import { assertFinalizationAccess, finalizeStatementStatus } from "./finalization";
test("only the two global financial roles can finalize",()=>{
  for(const role of ["central_finance","group_admin"]) expect(assertFinalizationAccess(role)).toBeUndefined();
  for(const role of [null,undefined,"company_finance","employee","approver","viewer",""]) expect(()=>assertFinalizationAccess(role)).toThrow("CLOSE_ACCESS_FORBIDDEN");
});
test("draft becomes final and immutable statuses never regress",()=>{
  expect(finalizeStatementStatus("draft")).toBe("final");
  expect(finalizeStatementStatus("final")).toBe("final");
  expect(finalizeStatementStatus("reconciled")).toBe("reconciled");
});
