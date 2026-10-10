import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { db } from "@smp/db";
import * as schema from "@smp/db/schema";
import { activityRecord, company, licenseAssignment, licenseRequest, licenseType, person, vendorAccount } from "@smp/db/schema";
import { evaluateInactivity, hasPositiveVendorActivity, type InactivityResult } from "@smp/domain/usage/inactivity";
import { companyScope, type LedgerAuthorization } from "../identity-access/authorization";
import { parseUsageFilters, serializeUsageFilters, UsageReadError, type UsageFilters } from "./filters";
export { UsageReadError } from "./filters";
export type UsageRow = InactivityResult & Readonly<{
  assignmentId: string; personId: string; personName: string;
  companyId: string; companyName: string; vendorAccountId: string; vendorAccountName: string;
  licenseTypeName: string; anchorState: (typeof licenseRequest.$inferSelect)["state"] | null;
}>;
export type UsageReadModel = Readonly<{
  filters: UsageFilters;
  companies: readonly { id: string; label: string }[];
  rows: readonly UsageRow[];
  metrics: Readonly<{ total: number; active: number; inactive: number; noData: number; activePercent: number }>;
  freshness: readonly { accountId: string; accountName: string; dataThrough: string; fallback: boolean }[];
  nextCursor: string | null;
}>;
type SortKey = { daysInactive: number | null; assignmentId: string };
function compareRows(a: SortKey, b: SortKey): number {
  if (a.daysInactive !== b.daysInactive) {
    if (a.daysInactive === null) return 1;
    if (b.daysInactive === null) return -1;
    return b.daysInactive - a.daysInactive;
  }
  return a.assignmentId < b.assignmentId ? -1 : a.assignmentId > b.assignmentId ? 1 : 0;
}
function decodeCursor(filters: UsageFilters): SortKey | null {
  if (!filters.cursor) return null;
  const cursorSchema = z.object({ companyId: z.string().uuid().nullable(), window: z.union([z.literal(30), z.literal(60), z.literal(90)]), sort: z.literal("age_desc_id_asc"), daysInactive: z.number().int().nonnegative().nullable(), assignmentId: z.string().uuid() }).strict();
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(filters.cursor)) throw new Error();
    const text = Buffer.from(filters.cursor, "base64url").toString("utf8");
    if (Buffer.from(text).toString("base64url") !== filters.cursor) throw new Error();
    const cursor = cursorSchema.parse(JSON.parse(text));
    if (cursor.companyId !== (filters.companyId ?? null) || cursor.window !== filters.window) throw new Error();
    return cursor;
  } catch { throw new UsageReadError("invalid_cursor"); }
}
function pairKey(personId: string, accountId: string) { return `${personId}:${accountId}`; }

export function createUsageRepository(database: NodePgDatabase<typeof schema>) {
  return {
    async read(authorization: LedgerAuthorization | null, input: UsageFilters, evaluationDate: string): Promise<UsageReadModel> {
      if (!authorization || authorization.globalRole !== "group_admin") throw new UsageReadError("access_denied");
      const filters = parseUsageFilters(serializeUsageFilters(input));
      const cursor = decodeCursor(filters);
      return database.transaction(async tx => {
        const companies = await tx.select({ id: company.id, label: company.name }).from(company)
          .where(companyScope(authorization, company.id, "company:read")).orderBy(asc(company.name), asc(company.id));
        if (filters.companyId && !companies.some(c => c.id === filters.companyId)) throw new UsageReadError("access_denied");
        const scope = and(companyScope(authorization, licenseAssignment.companyId, "company:read"), companyScope(authorization, person.companyId, "company:read"), filters.companyId ? eq(licenseAssignment.companyId, filters.companyId) : undefined, isNull(licenseAssignment.endedOn));
        const assignments = await tx.select({ assignmentId: licenseAssignment.id, personId: person.id, personName: person.fullName, companyId: company.id, companyName: company.name, vendorAccountId: vendorAccount.id, vendorAccountName: vendorAccount.name, licenseTypeName: licenseType.name, anchorState: licenseRequest.state }).from(licenseAssignment)
          .innerJoin(person, and(eq(person.id, licenseAssignment.personId), eq(person.companyId, licenseAssignment.companyId)))
          .innerJoin(company, eq(company.id, licenseAssignment.companyId))
          .innerJoin(vendorAccount, eq(vendorAccount.id, licenseAssignment.vendorAccountId))
          .innerJoin(licenseType, and(eq(licenseType.id, licenseAssignment.licenseTypeId), eq(licenseType.vendorId, vendorAccount.vendorId)))
          .leftJoin(licenseRequest, and(eq(licenseRequest.id, licenseAssignment.sourceRequestId), eq(licenseRequest.companyId, licenseAssignment.companyId), eq(licenseRequest.personId, licenseAssignment.personId), eq(licenseRequest.vendorAccountId, licenseAssignment.vendorAccountId), companyScope(authorization, licenseRequest.companyId, "company:read")))
          .where(scope);
        const accounts = [...new Map(assignments.map(a => [a.vendorAccountId, { accountId: a.vendorAccountId, accountName: a.vendorAccountName }])).values()].sort((a,b) => a.accountId.localeCompare(b.accountId));
        const watermarks = accounts.length === 0 ? [] : await tx.select({ accountId: activityRecord.vendorAccountId, dataThrough: max(activityRecord.activityDate) }).from(activityRecord).where(inArray(activityRecord.vendorAccountId, accounts.map(a => a.accountId))).groupBy(activityRecord.vendorAccountId);
        const throughByAccount = new Map(watermarks.map(w => [w.accountId, w.dataThrough]));
        const observations = assignments.length === 0 ? [] : await tx.selectDistinct({ personId: activityRecord.personId, accountId: activityRecord.vendorAccountId, activityDate: activityRecord.activityDate, counters: activityRecord.counters }).from(activityRecord)
          .innerJoin(licenseAssignment, and(eq(licenseAssignment.personId, activityRecord.personId), eq(licenseAssignment.vendorAccountId, activityRecord.vendorAccountId)))
          .innerJoin(person, and(eq(person.id, licenseAssignment.personId), eq(person.companyId, licenseAssignment.companyId)))
          .where(scope);
        const lastPositive = new Map<string, string>();
        for (const observation of observations) {
          if (!hasPositiveVendorActivity(observation.counters)) continue;
          const key = pairKey(observation.personId, observation.accountId);
          if (observation.activityDate > (lastPositive.get(key) ?? "")) lastPositive.set(key, observation.activityDate);
        }
        const evaluations = new Map<string, InactivityResult>();
        const rows = assignments.map(assignment => {
          const key = pairKey(assignment.personId, assignment.vendorAccountId);
          let evaluation = evaluations.get(key);
          if (!evaluation) {
            evaluation = evaluateInactivity({ evaluationDate, accountDataThrough: throughByAccount.get(assignment.vendorAccountId) ?? null, lastActivityDate: lastPositive.get(key) ?? null, window: filters.window });
            evaluations.set(key, evaluation);
          }
          return { ...assignment, ...evaluation };
        }).sort(compareRows);
        const total = rows.length;
        const active = rows.filter(r => r.classification === "active").length;
        const inactive = rows.filter(r => r.classification === "inactive").length;
        const noData = rows.filter(r => r.classification === "no_data").length;
        const freshness = accounts.map(account => {
          const through = throughByAccount.get(account.accountId) ?? null;
          return { ...account, dataThrough: evaluateInactivity({ evaluationDate, accountDataThrough: through, lastActivityDate: null, window: filters.window }).dataThrough, fallback: through === null };
        });
        const continued = cursor === null ? rows : rows.filter(row => compareRows(row, cursor) > 0);
        const page = continued.slice(0, 50);
        const last = page.at(-1);
        const nextCursor = continued.length > page.length && last ? Buffer.from(JSON.stringify({ companyId: filters.companyId ?? null, window: filters.window, sort: "age_desc_id_asc", daysInactive: last.daysInactive, assignmentId: last.assignmentId })).toString("base64url") : null;
        return { filters, companies, rows: page, metrics: { total, active, inactive, noData, activePercent: total === 0 ? 0 : 100 * active / total }, freshness, nextCursor };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
  };
}
export const usageRepository = createUsageRepository(db as unknown as NodePgDatabase<typeof schema>);
