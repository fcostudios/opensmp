import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- Types only; no database access in the renderer.
import type { company, statement, statementLine } from "@smp/db/schema";
import tokens from "../../../../../../packages/design-system/tokens.json";
import es from "./locales/es-EC.json";
import en from "./locales/en-US.json";

/** Server-only presentation seam. Callers must authorize and load a coherent
 * company-scoped snapshot before calling; this module never queries or closes. */
export interface StatementPdfInput {
  company: Pick<typeof company.$inferSelect, "id" | "name" | "code" | "statementLanguage">;
  statement: typeof statement.$inferSelect;
  lines: readonly (typeof statementLine.$inferSelect)[];
}

/** Decimal strings are displayed exactly, never summed or rounded in the PDF. */
export async function renderStatementPdf(input: StatementPdfInput): Promise<Buffer> {
  const { company, statement, lines } = input;
  if (company.id !== statement.companyId) throw new Error("Statement company mismatch");
  if (lines.some((line) => line.statementId !== statement.id)) throw new Error("Statement line mismatch");

  const english = company.statementLanguage === "en";
  const copy = english ? en : es;
  const locale = english ? "en-US" : "es-EC";
  const money = (value: string) => `USD ${english ? value : value.replace(".", ",")}`;
  // Date-only fields are calendar dates, not instants. Never shift their day.
  const date = (value: string | null) => value === null ? copy.missing : new Intl.DateTimeFormat(locale, {
    timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
  const stamp = (value: Date) => new Intl.DateTimeFormat(locale, {
    timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short", hour12: false,
  }).format(value);

  const doc = new PDFDocument({
    size: "A4", margins: { top: 120, bottom: 76, left: 40, right: 40 },
    autoFirstPage: false,
    info: { Title: copy.title, Author: "corporativo.", Creator: "Ledger", Producer: "Ledger statement template", CreationDate: statement.generatedAt, ModDate: statement.generatedAt },
    lang: locale,
  });
  doc.registerFont(tokens.typography.fontFamily.base, readFileSync(new URL("../../../../public/fonts/statement/Barlow-Regular.ttf", import.meta.url)));
  doc.registerFont(tokens.typography.fontFamily.display, readFileSync(new URL("../../../../public/fonts/statement/BarlowCondensed-Bold.ttf", import.meta.url)));
  doc.registerFont(tokens.typography.fontFamily.mono, readFileSync(new URL("../../../../public/fonts/statement/IBMPlexMono-Regular.ttf", import.meta.url)));
  const color = tokens.color;
  const body = tokens.typography.fontFamily.base;
  const mono = tokens.typography.fontFamily.mono;
  const display = tokens.typography.fontFamily.display;
  const left = 40;
  const width = 515;
  let page = 0;
  let activeFont = body;
  let activeSize = 10;
  doc.on("pageAdded", () => {
    page++;
    // Fixed furniture must render outside the body flow without triggering a
    // page break. PDFKit still wraps explicit-width text with lineBreak:false.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    // Positive typographic lockup; artwork slot is isolated from statement data.
    doc.font(body).fontSize(22).fillColor(color.text_primary).text("Corporativo", left, 30, { continued: true });
    doc.fillColor(color.primary).text(".");
    doc.font(body).fontSize(9).fillColor(color.text_secondary).text("Ledger", 480, 38, { width: 75, align: "right" });
    doc.rect(left, 72, 4, 26).fill(color.primary);
    doc.font(display).fontSize(24).fillColor(color.text_primary).text(copy.title, left + 14, 70);
    doc.font(mono).fontSize(8).fillColor(color.text_secondary).text(`${copy.period}: ${statement.period}`, left, 104);
    doc.moveTo(left, 780).lineTo(left + width, 780).strokeColor(color.border).stroke();
    doc.font(body).fontSize(8).fillColor(color.text_secondary).text(`${copy.period}: ${statement.period} | ${copy.generated}: ${stamp(statement.generatedAt)}`, left, 790);
    doc.font(body).fontSize(8).text(copy.integrity, left, 804);
    doc.font(mono).fontSize(8).text(`${copy.page} ${page}`, 480, 804, { width: 75, align: "right" });
    doc.page.margins.bottom = bottom;
    doc.font(activeFont).fontSize(activeSize).fillColor(color.text_primary);
    doc.x = left;
    doc.y = 128;
  });
  doc.addPage();

  function text(value: string, font = body, size = 10) {
    activeFont = font;
    activeSize = size;
    doc.font(font).fontSize(size).fillColor(color.text_primary).text(value, left, doc.y);
  }
  function space(points = 10) { doc.y += points; }
  function room(points: number) {
    if (doc.y + points > doc.page.height - doc.page.margins.bottom) doc.addPage();
  }

  text(`${company.name} (${company.code})`, display, 18);
  text(`${copy.status}: ${copy.statuses[statement.status]}`);
  text(`${copy.opening}: ${statement.openingSeats}`, mono);
  space(16);
  text(copy.detail, display, 16);
  if (lines.length === 0) text(copy.empty);

  // Input order is the stored snapshot's order. No live joins, proration,
  // movement inference or total calculation can change a closed statement.
  for (const line of lines) {
    room(110);
    space(8);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(color.border).stroke();
    space(8);
    text(copy.kind[line.kind], display, 14);
    text(`${copy.from}: ${date(line.periodFrom)}    ${copy.to}: ${date(line.periodTo)}`, mono, 9);
    text(`${copy.days}: ${line.licenseDays ?? copy.missing}    ${copy.rate}: ${line.rateUsd === null ? copy.missing : money(line.rateUsd)}`, mono, 9);
    const y = doc.y;
    doc.font(mono).fontSize(12).text(`${copy.amount}: ${money(line.amountUsd)}`, left, y, { width, align: "right" });
    space(5);
    if (line.note !== null) text(`${copy.note}: ${line.note}`);
    space(4);
    text(`${copy.line}: ${line.id}`, mono, 7);
    text(`${copy.person}: ${line.personId ?? copy.missing}`, mono, 7);
    text(`${copy.account}: ${line.vendorAccountId}`, mono, 7);
    text(`${copy.license}: ${line.licenseTypeId ?? copy.missing}`, mono, 7);
    text(`${copy.assignment}: ${line.assignmentId ?? copy.missing}`, mono, 7);
  }

  room(130);
  space(18);
  doc.rect(left, doc.y, width, 38).fill(color.surface_muted);
  const totalY = doc.y + 10;
  doc.font(display).fontSize(16).fillColor(color.text_primary).text(copy.total, left + 12, totalY);
  doc.font(mono).fontSize(16).text(money(statement.totalUsd), left + 190, totalY, { width: width - 202, align: "right" });
  doc.y = totalY + 40;
  text(`${copy.statement}: ${statement.id}`, mono, 7);
  text(`${copy.close}: ${statement.closeRunId ?? copy.missing}`, mono, 7);
  text(`${copy.created}: ${stamp(statement.createdAt)}`, mono, 7);
  doc.end();
  const chunks: Buffer[] = [];
  for await (const chunk of doc) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
