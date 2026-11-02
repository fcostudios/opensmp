import { csvCell as cell } from "@smp/domain/csv";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "@smp/db/schema";
import { auditLog, company, statement, statementLine, person, vendorAccount, licenseType } from "@smp/db/schema";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { statementCompanyIds } from "./repository";
import { renderStatementPdf } from "./pdf/render";
import english from "../../../messages/en-US.json";
import spanish from "../../../messages/es-EC.json";

function authorizedId(authorization: LedgerAuthorization | null, input: unknown) {
  if (!authorization) throw new Error("UNAUTHORIZED");
  const ids = statementCompanyIds(authorization);
  const parsed = z.string().uuid().safeParse(input);
  if (!parsed.success) throw new Error("INVALID_STATEMENT_ID");
  return { ids, id: parsed.data };
}

/** The URL carries no tenant or locale; the download reauthorizes independently. */
export function createStatementCsvDownload(authorization: LedgerAuthorization | null, input: unknown) {
  const { id } = authorizedId(authorization, input);
  return { downloadUrl: `/api/v1/statements/${id}/export/csv` };
}

/** The PDF action follows the same read-only URL contract as CSV. */
export function createStatementPdfDownload(authorization: LedgerAuthorization | null, input: unknown) {
  const { id } = authorizedId(authorization, input);
  return { downloadUrl: `/api/v1/statements/${id}/export/pdf` };
}

export function createStatementExportService(database: NodePgDatabase<typeof schema>, now = () => new Date()) {
  return {
    async exportPdf(authorization: LedgerAuthorization | null, input: unknown) {
      const { ids, id } = authorizedId(authorization, input);
      return database.transaction(async tx => {
        const [snapshot] = await tx.select({ statement, company: { id: company.id, code: company.code, name: company.name, statementLanguage: company.statementLanguage } })
          .from(statement).innerJoin(company, and(eq(company.id, statement.companyId), inArray(company.id, ids)))
          .where(and(eq(statement.id, id), inArray(statement.companyId, ids)));
        if (!snapshot) throw new Error("STATEMENT_NOT_FOUND");
        // Match US-036 detail's stored S1 facts, without deriving new usage or amounts.
        const lines = await tx.select({ line: statementLine }).from(statementLine)
          .innerJoin(statement, eq(statement.id, statementLine.statementId))
          .where(and(eq(statementLine.statementId, id), eq(statement.companyId, snapshot.statement.companyId), inArray(statementLine.kind, ["license", "adjustment"])))
          .orderBy(asc(statementLine.id));
        const pdf = await renderStatementPdf({ ...snapshot, lines: lines.map(entry => entry.line) });
        const row = snapshot.statement;
        await tx.insert(auditLog).values({ action: "statement.export_pdf", entityType: "Statement", entityId: id,
          actorUserId: authorization!.userAccountId, companyId: row.companyId, before: null, note: null,
          after: { format: "pdf", period: row.period, status: row.status, language: snapshot.company.statementLanguage ?? "es", totalUsd: row.totalUsd, lineCount: lines.length }, occurredAt: now() });
        return { pdf, filename: `statement-${id}-${row.period}.pdf` };
      }, { isolationLevel: "repeatable read" });
    },
    async exportCsv(authorization: LedgerAuthorization | null, input: unknown) {
      const { ids, id } = authorizedId(authorization, input);
      return database.transaction(async tx => {
        const [header] = await tx.select({ statement, code: company.code, name: company.name, language: company.statementLanguage })
          .from(statement).innerJoin(company, and(eq(company.id, statement.companyId), inArray(company.id, ids)))
          .where(and(eq(statement.id, id), inArray(statement.companyId, ids)));
        if (!header) throw new Error("STATEMENT_NOT_FOUND");
        const lines = await tx.select({ line: statementLine, personName: person.fullName, organization: vendorAccount.name, license: licenseType.name })
          .from(statementLine).innerJoin(statement, eq(statement.id, statementLine.statementId))
          .innerJoin(vendorAccount, eq(vendorAccount.id, statementLine.vendorAccountId))
          .leftJoin(person, and(eq(person.id, statementLine.personId), eq(person.companyId, header.statement.companyId)))
          .leftJoin(licenseType, eq(licenseType.id, statementLine.licenseTypeId))
          .where(and(eq(statementLine.statementId, id), eq(statement.companyId, header.statement.companyId), inArray(statementLine.kind, ["license", "adjustment"])))
          .orderBy(asc(statementLine.id));
        const language = header.language ?? "es";
        const labels = language === "en" ? english : spanish;
        const t = labels.statements, d = labels.statementDetail, row = header.statement;
        const columns = [t.company,t.period,t.status,t.openingSeats,t.total,t.generatedAt,t.statementId,t.closeRun,d.kind,d.person,d.organization,d.licenseType,d.periodFrom,d.periodTo,d.seatDays,d.rate,d.amount,d.note];
        const metadata = [cell(`${header.code} · ${header.name}`),cell(row.period),cell(t[row.status]),cell(row.openingSeats,true),cell(row.totalUsd,true),cell(row.generatedAt.toISOString()),cell(row.id),cell(row.closeRunId)];
        const records = (lines.length ? lines : [null]).map(entry => [...metadata, ...[
          cell(entry ? d[entry.line.kind === "license" ? "license" : "adjustment"] : null),
          cell(entry?.personName ?? null),cell(entry?.organization ?? null),cell(entry?.license ?? null),
          cell(entry?.line.periodFrom ?? null),cell(entry?.line.periodTo ?? null),
          cell(entry?.line.licenseDays ?? null,true),cell(entry?.line.rateUsd ?? null,true),cell(entry?.line.amountUsd ?? null,true),cell(entry?.line.note ?? null),
        ]].join(","));
        const csv = [columns.map(value => cell(value)).join(","), ...records].join("\r\n") + "\r\n";
        await tx.insert(auditLog).values({ action: "statement.export_csv", entityType: "Statement", entityId: id,
          actorUserId: authorization!.userAccountId, companyId: row.companyId, before: null, note: null,
          after: { format: "csv", period: row.period, status: row.status, language, totalUsd: row.totalUsd, lineCount: lines.length }, occurredAt: now() });
        return { csv, filename: `statement-${id}-${row.period}.csv` };
      }, { isolationLevel: "repeatable read" });
    },
  };
}

export async function createStatementExportResponse(service: ReturnType<typeof createStatementExportService>, authorization: LedgerAuthorization | null, input: unknown) {
  try {
    const { csv, filename } = await service.exportCsv(authorization, input);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${filename}"` } });
  } catch (error) {
    return exportErrorResponse(error);
  }
}

export async function createStatementPdfExportResponse(service: ReturnType<typeof createStatementExportService>, authorization: LedgerAuthorization | null, input: unknown) {
  try {
    const { pdf, filename } = await service.exportPdf(authorization, input);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${filename}"` } });
  } catch (error) {
    return exportErrorResponse(error);
  }
}

function exportErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const statuses: Record<string, number> = { UNAUTHORIZED: 401, STATEMENTS_ACCESS_FORBIDDEN: 403, INVALID_STATEMENT_ID: 400, STATEMENT_NOT_FOUND: 404 };
  const status = statuses[code];
  if (!status) throw error;
  return Response.json({ error: code }, { status, headers: { "Cache-Control": "private, no-store" } });
}
