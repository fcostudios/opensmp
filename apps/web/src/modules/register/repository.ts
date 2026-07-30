import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { RegisterFilters } from "@smp/contracts/register";
import { db } from "@smp/db";
import {
  company,
  licenseAssignment,
  licenseRequest,
  license_request_state_enum,
  licenseType,
  person,
  statement,
  statementLine,
  vendorAccount,
} from "@smp/db/schema";
import { permittedCompanyIds } from "@smp/domain/identity-access";
import * as schema from "@smp/db/schema";

import type { LedgerAuthorization } from "../identity-access/authorization";

type Database = NodePgDatabase<typeof schema>;

export interface RegisterStatementLine {
  readonly amountUsd: string;
  readonly assignmentId: string | null;
  readonly companyId: string;
  readonly id: string;
  readonly licenseDays: number | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly statementPeriod: string;
  readonly statementId: string;
}

export interface RegisterRow {
  readonly companyCode: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly endReason: "left_company" | "inactive" | "reallocated" | null;
  readonly endedOn: string | null;
  readonly id: string;
  readonly licenseTypeId: string;
  readonly licenseTypeName: string;
  readonly note: string | null;
  readonly personId: string;
  readonly personName: string;
  readonly sourceKind: "request" | "import" | "reconciliation";
  readonly sourceRequestApprovalState: "approved" | "pending" | "rejected" | null;
  readonly sourceRequestDecidedAt: string | null;
  readonly sourceRequestId: string | null;
  readonly sourceRequestNo: string | null;
  readonly startedOn: string;
  readonly statementLines: readonly RegisterStatementLine[];
  readonly vendorAccountId: string;
  readonly vendorAccountName: string;
}

export interface RegisterPage {
  readonly items: readonly RegisterRow[];
  readonly nextCursor: string | null;
}

export interface RegisterFacets {
  readonly companies: readonly { readonly id: string; readonly label: string }[];
  readonly endReasons: readonly ("left_company" | "inactive" | "reallocated")[];
  readonly licenseTypes: readonly { readonly id: string; readonly label: string }[];
  readonly people: readonly { readonly id: string; readonly label: string }[];
  readonly sourceRequestNos: readonly string[];
  readonly vendorAccounts: readonly { readonly id: string; readonly label: string }[];
}

function readScope(
  authorization: LedgerAuthorization,
  column: AnyPgColumn,
): SQL {
  const permitted = permittedCompanyIds(authorization, "finance:read");
  if (permitted === "all") return sql`TRUE`;
  const ids = [...permitted];
  return inArray(column, ids);
}

function decodeCursor(cursor: string): { readonly id: string; readonly startedOn: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid register cursor encoding");
  }
  const result = z.object({
    id: z.string().uuid(),
    startedOn: z.string().refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }),
  }).strict().safeParse(parsed);
  if (!result.success) throw new Error("Invalid register cursor");
  return result.data;
}

function encodeCursor(row: Pick<RegisterRow, "id" | "startedOn">): string {
  return Buffer.from(JSON.stringify({ id: row.id, startedOn: row.startedOn })).toString("base64url");
}

function filterConditions(filters: RegisterFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.companyId) conditions.push(eq(licenseAssignment.companyId, filters.companyId));
  if (filters.vendorAccountId) conditions.push(eq(licenseAssignment.vendorAccountId, filters.vendorAccountId));
  if (filters.licenseTypeId) conditions.push(eq(licenseAssignment.licenseTypeId, filters.licenseTypeId));
  if (filters.personId) conditions.push(eq(licenseAssignment.personId, filters.personId));
  if (filters.sourceKind) conditions.push(eq(licenseAssignment.sourceKind, filters.sourceKind));
  if (filters.sourceRequestNo) conditions.push(eq(licenseRequest.requestNo, filters.sourceRequestNo));
  if (filters.openState === "open") conditions.push(isNull(licenseAssignment.endedOn));
  if (filters.openState === "closed") conditions.push(sql`${licenseAssignment.endedOn} IS NOT NULL`);
  if (filters.endReason) conditions.push(eq(licenseAssignment.endReason, filters.endReason));
  if (filters.startDate) conditions.push(gte(licenseAssignment.startedOn, filters.startDate));
  if (filters.endDate) conditions.push(lte(licenseAssignment.startedOn, filters.endDate));
  return conditions;
}

function csvCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  const safe = /^[\s\0-\x1f]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function renderRegisterCsvRows(rows: readonly RegisterRow[]): string {
  // Stable, locale-neutral register_v1 contract: identifiers stay canonical
  // while user-managed display names remain the values captured in Ledger.
  return rows.map((row) => [
    "register_v1",
    row.personName, row.companyCode, row.vendorAccountName, row.licenseTypeName,
    row.startedOn, row.endedOn, row.endReason,
    row.sourceKind, row.sourceRequestNo, row.note,
  ].map(csvCell).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

function registerCsvHeader(): string {
  return "schema_version,person_name,company_code,vendor_account_name,license_type_name,started_on,ended_on,end_reason,source_kind,source_request_no,note\r\n";
}

function requestApprovalState(
  state: typeof license_request_state_enum.enumValues[number] | null,
  decidedAt: Date | null,
): RegisterRow["sourceRequestApprovalState"] {
  if (!state) return null;
  if (state === "rejected") return "rejected";
  return decidedAt ? "approved" : "pending";
}

export function createRegisterRepository(database: Database) {
  async function queryRows(
    authorization: LedgerAuthorization,
    filters: RegisterFilters,
    pageSize: number | undefined,
  ): Promise<RegisterPage> {
    const conditions = [readScope(authorization, licenseAssignment.companyId), ...filterConditions(filters)];
    if (pageSize !== undefined && filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      conditions.push(or(
        gt(licenseAssignment.startedOn, cursor.startedOn),
        and(eq(licenseAssignment.startedOn, cursor.startedOn), gt(licenseAssignment.id, cursor.id)),
      )!);
    }
    const limit = pageSize;
    const query = database
      .select({
        id: licenseAssignment.id,
        personId: person.id,
        personName: person.fullName,
        companyId: company.id,
        companyName: company.name,
        companyCode: company.code,
        vendorAccountId: vendorAccount.id,
        vendorAccountName: vendorAccount.name,
        licenseTypeId: licenseType.id,
        licenseTypeName: licenseType.name,
        startedOn: licenseAssignment.startedOn,
        endedOn: licenseAssignment.endedOn,
        endReason: licenseAssignment.endReason,
        sourceKind: licenseAssignment.sourceKind,
        sourceRequestDecidedAt: licenseRequest.decidedAt,
        sourceRequestId: licenseAssignment.sourceRequestId,
        sourceRequestNo: licenseRequest.requestNo,
        sourceRequestState: licenseRequest.state,
        note: licenseAssignment.note,
      })
      .from(licenseAssignment)
      .innerJoin(person, and(eq(person.id, licenseAssignment.personId), eq(person.companyId, licenseAssignment.companyId)))
      .innerJoin(company, eq(company.id, licenseAssignment.companyId))
      .innerJoin(vendorAccount, eq(vendorAccount.id, licenseAssignment.vendorAccountId))
      .innerJoin(licenseType, eq(licenseType.id, licenseAssignment.licenseTypeId))
      .leftJoin(licenseRequest, and(eq(licenseRequest.id, licenseAssignment.sourceRequestId), eq(licenseRequest.companyId, licenseAssignment.companyId)))
      .where(and(...conditions))
      .orderBy(asc(licenseAssignment.startedOn), asc(licenseAssignment.id));
    const selected = await (limit ? query.limit(limit + 1) : query);
    const hasMore = selected.length > (limit ?? selected.length);
    const rawRows = hasMore ? selected.slice(0, limit) : selected;
    const assignmentIds = rawRows.map((row) => row.id);
    const lines = await database
      .select({
        id: statementLine.id,
        assignmentId: statementLine.assignmentId,
        companyId: statement.companyId,
        statementPeriod: statement.period,
        statementId: statement.id,
        licenseDays: statementLine.licenseDays,
        amountUsd: statementLine.amountUsd,
        periodFrom: statementLine.periodFrom,
        periodTo: statementLine.periodTo,
      })
      .from(statementLine)
      .innerJoin(statement, eq(statement.id, statementLine.statementId))
      .innerJoin(licenseAssignment, and(eq(licenseAssignment.id, statementLine.assignmentId), eq(licenseAssignment.companyId, statement.companyId)))
      .where(and(
        inArray(statementLine.assignmentId, assignmentIds),
        readScope(authorization, statement.companyId),
      ))
      .orderBy(asc(statement.period), asc(statementLine.id));
    const linesByAssignment = new Map<string, RegisterStatementLine[]>();
    for (const line of lines) {
      const assignmentId = line.assignmentId!;
      const existing = linesByAssignment.get(assignmentId) ?? [];
      existing.push(line);
      linesByAssignment.set(assignmentId, existing);
    }
    const items: RegisterRow[] = rawRows.map(({
      sourceRequestDecidedAt,
      sourceRequestState,
      ...row
    }) => ({
      ...row,
      sourceRequestApprovalState: requestApprovalState(
        sourceRequestState,
        sourceRequestDecidedAt,
      ),
      sourceRequestDecidedAt: sourceRequestDecidedAt?.toISOString() ?? null,
      statementLines: linesByAssignment.get(row.id) ?? [],
    }));
    return {
      items,
      nextCursor: hasMore ? encodeCursor(items.at(-1)!) : null,
    };
  }

  return {
    async *streamCsv(authorization: LedgerAuthorization, filters: RegisterFilters): AsyncGenerator<string> {
      let cursor: string | undefined;
      try {
        yield registerCsvHeader();
        do {
          const page = await queryRows(authorization, { ...filters, cursor, limit: 100 }, 100);
          yield renderRegisterCsvRows(page.items);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      } finally {
        // The shared Drizzle pool releases every completed query; generator cancellation
        // stops before the next keyset batch and therefore retains no database cursor.
      }
    },
    async facets(authorization: LedgerAuthorization): Promise<RegisterFacets> {
      const rows = await database.select({ companyId: company.id, companyName: company.name, companyCode: company.code, endReason: licenseAssignment.endReason, licenseTypeId: licenseType.id, licenseTypeName: licenseType.name, personId: person.id, personName: person.fullName, sourceRequestNo: licenseRequest.requestNo, vendorAccountId: vendorAccount.id, vendorAccountName: vendorAccount.name }).from(licenseAssignment).innerJoin(person, and(eq(person.id, licenseAssignment.personId), eq(person.companyId, licenseAssignment.companyId))).innerJoin(company, eq(company.id, licenseAssignment.companyId)).innerJoin(vendorAccount, eq(vendorAccount.id, licenseAssignment.vendorAccountId)).innerJoin(licenseType, eq(licenseType.id, licenseAssignment.licenseTypeId)).leftJoin(licenseRequest, and(eq(licenseRequest.id, licenseAssignment.sourceRequestId), eq(licenseRequest.companyId, licenseAssignment.companyId))).where(readScope(authorization, licenseAssignment.companyId)).orderBy(asc(company.name), asc(person.fullName), asc(licenseRequest.requestNo));
      const distinct = (values: readonly { readonly id: string; readonly label: string }[]) => [...new Map(values.map((value) => [value.id, value])).values()];
      return { companies: distinct(rows.map((row) => ({ id: row.companyId, label: `${row.companyName} (${row.companyCode})` }))), endReasons: [...new Set(rows.flatMap((row) => row.endReason ? [row.endReason] : []))], licenseTypes: distinct(rows.map((row) => ({ id: row.licenseTypeId, label: row.licenseTypeName }))), people: distinct(rows.map((row) => ({ id: row.personId, label: row.personName }))), sourceRequestNos: [...new Set(rows.flatMap((row) => row.sourceRequestNo ? [row.sourceRequestNo] : []))], vendorAccounts: distinct(rows.map((row) => ({ id: row.vendorAccountId, label: row.vendorAccountName }))) };
    },
    async exportCsv(authorization: LedgerAuthorization, filters: RegisterFilters): Promise<string> {
      const { items } = await queryRows(authorization, filters, undefined);
      return registerCsvHeader() + renderRegisterCsvRows(items);
    },
    async listRows(authorization: LedgerAuthorization, filters: RegisterFilters): Promise<RegisterPage> {
      return queryRows(authorization, filters, filters.limit ?? 50);
    },
  };
}

export type RegisterRepository = ReturnType<typeof createRegisterRepository>;
export const registerRepository = createRegisterRepository(db as unknown as Database);
