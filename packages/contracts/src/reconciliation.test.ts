import { beforeEach,expect,test,vi } from "vitest";
let contracts: typeof import("./reconciliation");
// Schema declarations execute at import time. Reload under each active mutation,
// so eager Zod objects cannot retain the dry-run module cache.
beforeEach(async()=>{vi.resetModules();contracts=await import("./reconciliation");});
const key={period:"2026-01",vendorAccountId:"38000000-0000-4000-8000-000000000001"};
test("invoice command rejects untrusted state/rollup/actor and non-cent or invalid money",()=>{
 expect(contracts.saveInvoiceSchema.parse({...key,invoiceAmountUsd:"0.00"}).invoiceAmountUsd).toBe("0.00");
 for(const amount of ["123", "1.2", "9999999999.99"])expect(contracts.saveInvoiceSchema.parse({...key,invoiceAmountUsd:amount}).invoiceAmountUsd).toBe(amount);
 for(const value of ["-1.00","1.001","10000000000.00","1e3","abc","1.00x",""])expect(contracts.saveInvoiceSchema.safeParse({...key,invoiceAmountUsd:value}).success).toBe(false);
 for(const extra of [{status:"reconciled"},{rollupAmountUsd:"1.00"},{overriddenBy:key.vendorAccountId}])expect(contracts.saveInvoiceSchema.safeParse({...key,invoiceAmountUsd:"1.00",...extra}).success).toBe(false);
 for(const bad of [{period:"2026-13"},{period:"2026-00"},{vendorAccountId:"invalid"}])expect(contracts.saveInvoiceSchema.safeParse({...key,...bad,invoiceAmountUsd:"1.00"}).success).toBe(false);
});
test("override requires a meaningful bounded note and strips surrounding whitespace",()=>{
 for(const note of ["", "   ", "x".repeat(2001)])expect(contracts.overrideReconciliationSchema.safeParse({...key,note}).success).toBe(false);
 expect(contracts.overrideReconciliationSchema.parse({...key,note:"  Approved  "}).note).toBe("Approved");
});
test("variance validates evidence scheme, cause and detail and requires a pinned delete identity",()=>{
 const line={...key,cause:"timing",detail:"  Explanation  ",registerAmountUsd:"10.00",invoiceAmountUsd:"11.00",evidenceUrl:null};
 expect(contracts.saveVarianceSchema.parse(line).detail).toBe("Explanation");
 expect(contracts.saveVarianceSchema.parse({...line,evidenceUrl:"https://example.test/evidence"}).evidenceUrl).toBe("https://example.test/evidence");
 expect(contracts.saveVarianceSchema.parse({...line,evidenceUrl:"http://example.test/evidence"}).evidenceUrl).toBe("http://example.test/evidence");
 for(const bad of [{cause:"unknown"},{detail:"   "},{detail:"x".repeat(2001)},{evidenceUrl:"javascript:alert(1)"},{evidenceUrl:"ftp://example.test"},{evidenceUrl:"ftp://example.test/https://embedded.test"},{evidenceUrl:"https://example.test/"+"x".repeat(2000)},{lineId:"bad"}])expect(contracts.saveVarianceSchema.safeParse({...line,...bad}).success).toBe(false);
 expect(contracts.deleteVarianceSchema.safeParse(key).success).toBe(false);
 expect(contracts.deleteVarianceSchema.parse({...key,lineId:key.vendorAccountId}).lineId).toBe(key.vendorAccountId);
});
