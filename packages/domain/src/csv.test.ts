import { expect, test } from "vitest";
import { csvCell } from "./csv";

test("CSV cells escape delimiters and spreadsheet formulas while preserving trusted numeric decimals", () => {
  expect(csvCell(null)).toBe("");
  expect(csvCell(0)).toBe("0");
  expect(csvCell('a,"b"\r\nc')).toBe('"a,""b""\r\nc"');
  for (const value of ["=1+1", "+SUM(A1)", "-cmd", "@formula", "\t=1", " =1", "\u2003=1", "\0+1", "\r\n-1"]) {
    const rendered=csvCell(value);
    expect(rendered.startsWith("'") || rendered.startsWith('"\'')).toBe(true);
  }
  for (const value of ["A-B", "a+b", "person@example.invalid"]) {
    expect(csvCell(value)).toBe(value);
  }
  expect(csvCell("-4.00", true)).toBe("-4.00");
  expect(csvCell("12.3400", true)).toBe("12.3400");
});
