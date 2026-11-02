import { expect, test } from "vitest";
import fc from "fast-check";
import { compareInvoice, cents } from "./reconciliation";

// Kills an exclusive threshold, wrong denominator, lost sign and rounded percentage.
test.each([
  ["10049.00", "10000.00", "49.00", true],
  ["10050.00", "10000.00", "50.00", true],
  ["10051.00", "10000.00", "51.00", false],
  ["9951.00", "10000.00", "-49.00", true],
  ["9950.00", "10000.00", "-50.00", true],
  ["9949.00", "10000.00", "-51.00", false],
  ["0.00", "0.00", "0.00", true],
  ["0.01", "0.00", "0.01", false],
  ["0.00", "0.01", "-0.01", false],
])("BR-20 compares %s to invoice %s", (rollup, invoice, varianceUsd, withinTolerance) => {
  expect(compareInvoice(rollup, invoice)).toEqual({ varianceUsd, withinTolerance });
});
test("money comparison preserves the sign and exact sub-cent tolerance over seeded amounts", () => {
  fc.assert(fc.property(fc.integer({min:0,max:999999999}), fc.integer({min:-10000,max:10000}), (invoice, delta) => {
    const rollup = invoice + delta;
    const money = (n:number) => `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n)/100)}.${String(Math.abs(n)%100).padStart(2,"0")}`;
    const result=compareInvoice(money(rollup),money(invoice));
    expect(result.varianceUsd).toBe(money(delta));
    expect(result.withinTolerance).toBe(Math.abs(delta) <= invoice/200);
  }),{seed:38,numRuns:500});
});
test("rejects malformed, oversized and negative invoice amounts before comparison", () => {
  for(const value of ["NaN","1e3","1.001","", "10000000000.00"]) expect(()=>cents(value)).toThrow("INVALID_MONEY");
  expect(()=>compareInvoice("1.00","-1.00")).toThrow("INVALID_INVOICE");
});

test("accepts whole and single-decimal USD without losing cent precision at numeric(12,2) limits",()=>{
 expect(compareInvoice("1","1.0")).toEqual({varianceUsd:"0.00",withinTolerance:true});
 expect(cents("-0.1")).toBe(BigInt(-10));
 expect(cents("9999999999.99")).toBe(BigInt("999999999999"));
});
