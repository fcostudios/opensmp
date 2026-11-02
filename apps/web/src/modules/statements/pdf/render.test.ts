import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fixture from "./testing/statement.json";
import { renderStatementPdf, type StatementPdfInput } from "./render";

function input(language: "es" | "en" | null = null): StatementPdfInput {
  return {
    ...fixture,
    company: { ...fixture.company, statementLanguage: language },
    statement: { ...fixture.statement, status: "final", generatedAt: new Date(fixture.statement.generatedAt), createdAt: new Date(fixture.statement.createdAt) },
    lines: fixture.lines.map((line) => ({ ...line, kind: line.kind as "license" | "usage" })),
  };
}

async function pages(bytes: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const result = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    result.push(content.items.filter((item) => "str" in item).map((item) => item.str).join(" ").replace(/\s+/g, " "));
  }
  await doc.destroy();
  return result;
}

describe("US-049 statement PDF", () => {
  // Catches a missing field, recomputed total, language regression or lost accent.
  it.each([
    [null, "ESTADO DE CUENTA", "USD 47,75", "16/10/2026", "15/10/2026"],
    ["en", "ACCOUNT STATEMENT", "USD 47.75", "10/16/2026", "10/15/2026"],
  ] as const)("renders stored facts in company language %s", async (language, title, total, join, leave) => {
    const text = (await pages(await renderStatementPdf(input(language)))).join(" ");
    for (const value of [title, total, join, leave, "Compañía del Pacífico", "2026-10", "12", "1.50".replace(".", language === "en" ? "." : ","), fixture.statement.id, fixture.statement.closeRunId, ...fixture.lines.flatMap((line) => [line.id, line.note, line.vendorAccountId, ...[line.personId, line.licenseTypeId, line.assignmentId].filter((value): value is string => value !== null)])]) {
      expect(text).toContain(value);
    }
    expect(text).toMatch(/Corporativo\s*\./);
    // The supplied total is authoritative, even if a future caller supplies
    // rounded totals differing from the sum of the visible lines.
    const changed = input(language);
    changed.statement.totalUsd = "999.99";
    expect((await pages(await renderStatementPdf(changed))).join(" ")).toContain(language === "en" ? "USD 999.99" : "USD 999,99");
  });

  // Catches cross-tenant company substitution and a line from another statement.
  it("rejects mixed-company and mixed-statement input before emitting a PDF", async () => {
    const wrongCompany = input();
    wrongCompany.company.id = "other-company";
    await expect(renderStatementPdf(wrongCompany)).rejects.toThrow("Statement company mismatch");
    const wrongLine = input();
    wrongLine.lines = [{ ...wrongLine.lines[0], statementId: "other-statement" }];
    await expect(renderStatementPdf(wrongLine)).rejects.toThrow("Statement line mismatch");
  });

  // Catches clipped long notes, omitted rows and footer/header pagination loss.
  it("paginates long notes and many rows without losing the last fact or total", async () => {
    const data = input("en");
    data.lines = Array.from({ length: 20 }, (_, n) => ({ ...data.lines[0], id: `line-${n}`, note: n === 0 ? "Long evidence note. ".repeat(400) + "END-OF-NOTE" : `ROW-${n}` }));
    const bytes = await renderStatementPdf(data);
    const text = await pages(bytes);
    expect(text.length).toBeGreaterThan(3);
    // A sentence can cross a page boundary, with furniture between its words
    // in PDF extraction order. Count each word to detect any lost body text.
    for (const word of [/\bLong\b/g, /\bevidence\b/g, /\bnote\./g]) {
      expect(text.join(" ").match(word)).toHaveLength(400);
    }
    expect(text.join(" ")).toContain("END-OF-NOTE");
    expect(text.join(" ")).toContain("ROW-19");
    expect(text.at(-1)).toContain("USD 47.75");
    for (const page of text) {
      expect(page).toContain("ACCOUNT STATEMENT");
      expect(page).toContain("2026-10");
      expect(page).toContain("Page");
    }
    expect(bytes.equals(readFileSync(join(import.meta.dirname, "testing", "statement-overflow-en.pdf")))).toBe(true);
  });

  // Catches absent/zero confusion and dropped adjustment credits.
  it("renders empty statements, nullable fields and signed adjustment amounts", async () => {
    const empty = input();
    empty.lines = [];
    empty.statement.totalUsd = "0.00";
    empty.statement.closeRunId = null;
    const emptyText = (await pages(await renderStatementPdf(empty))).join(" ");
    expect(emptyText).toContain("Sin líneas");
    expect(emptyText).toContain("Cierre: —");
    const credit = input("en");
    credit.lines = [{ ...credit.lines[2], kind: "adjustment", licenseDays: 0, amountUsd: "-1.25", note: null }];
    const text = (await pages(await renderStatementPdf(credit))).join(" ");
    expect(text).toContain("Adjustment");
    expect(text).toContain("USD -1.25");
    expect(text).toContain("Days: 0");
    expect(text).toContain("From: — To: —");
    expect(text).toContain("Rate: —");
    expect(text).not.toContain("Note: null");
  });

  // Byte-level fixtures pin embedded fonts, layout and all per-language copy.
  it.each(["es", "en"] as const)("matches the reviewed %s fixture PDF", async (language) => {
    const actual = await renderStatementPdf(input(language));
    const expected = readFileSync(join(import.meta.dirname, "testing", `statement-${language}.pdf`));
    expect(actual.equals(expected)).toBe(true);
  });
});
