import {
  normalizeActivityCounters,
  type ActivityIdentityWarning,
  type ActivityIngestionRecord,
  type IngestionSource,
  type JsonValue,
} from "@smp/connectors";
import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";
import { SYSTEM_USER_ID, SYSTEM_USER_EMAIL } from "./system-ids.js";

// Shared query builders work with the application driver and PostgreSQL transactions.
type ActivityDatabase = Pick<PgDatabase<PgQueryResultHKT, typeof schema>, "select" | "insert" | "transaction">;
type Matcher = Pick<ActivityDatabase, "select">;
export type ActivityBatch = Readonly<{
  companyId: string;
  vendorAccountId: string;
  activityDate: string;
  source: IngestionSource;
  syncedAt: Date;
  actorUserAccountId: string | null;
  records: readonly ActivityIngestionRecord[];
}>;
export type ActivityBatchResult = Readonly<{
  written: number;
  ignored: number;
  warnings: readonly ActivityIdentityWarning[];
}>;

function validateUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("ACTIVITY_INVALID_UUID");
  }
}
function validateDate(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("ACTIVITY_INVALID_DATE");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("ACTIVITY_INVALID_DATE");
}
function normalizeEmail(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("ACTIVITY_INVALID_EMAIL");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ACTIVITY_INVALID_EMAIL");
  return email;
}
// Stable object-key ordering is only for in-batch duplicate detection. Persisted
// replay comparison is performed by PostgreSQL JSONB, not serialization order.
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
type IndexedRecord = { record: ActivityIngestionRecord; recordIndex: number };
function validateRecords(records: readonly ActivityIngestionRecord[], date?: string): IndexedRecord[] {
  if (!Array.isArray(records)) throw new Error("ACTIVITY_INVALID_RECORDS");
  const emails = new Map<string, IndexedRecord>();
  const providerIds = new Map<string, string | null>();
  const unique: IndexedRecord[] = [];
  records.forEach((input, recordIndex) => {
    if (!input || typeof input !== "object") throw new Error("ACTIVITY_INVALID_RECORD");
    validateDate(input.activityDate);
    if (date !== undefined && input.activityDate !== date) throw new Error("ACTIVITY_DATE_MISMATCH");
    const email = normalizeEmail(input.email);
    if (input.providerUserId !== null && typeof input.providerUserId !== "string") throw new Error("ACTIVITY_INVALID_PROVIDER_ID");
    const record = { email, providerUserId: input.providerUserId, activityDate: input.activityDate, counters: normalizeActivityCounters(input.counters) };
    if (record.providerUserId !== null) {
      if (providerIds.has(record.providerUserId) && providerIds.get(record.providerUserId) !== email) throw new Error("ACTIVITY_IDENTITY_CONFLICT");
      providerIds.set(record.providerUserId, email);
    }
    const identity = email !== null ? `email:${email}` : (record.providerUserId === null ? null : `provider:${record.providerUserId}`);
    const key = identity === null ? null : `${identity}:${record.activityDate}`;
    const previous = key === null ? undefined : emails.get(key);
    if (previous) {
      if (previous.record.providerUserId !== record.providerUserId || canonical(previous.record.counters) !== canonical(record.counters)) throw new Error("ACTIVITY_DUPLICATE_CONFLICT");
      return;
    }
    const indexed = { record, recordIndex };
    if (key !== null) emails.set(key, indexed);
    unique.push(indexed);
  });
  return unique;
}

async function matchPerson(database: Matcher, companyId: string, email: string, lock = false) {
  const query = database.select({ id: schema.person.id, companyId: schema.person.companyId })
    .from(schema.person).where(and(eq(schema.person.companyId, companyId), sql`lower(trim(${schema.person.email}))=${email}`));
  const matches = await (lock ? query.for("share") : query);
  if (matches.length > 1) throw new Error("ACTIVITY_AMBIGUOUS_IDENTITY");
  return matches[0];
}
function warning(indexed: IndexedRecord, reason: ActivityIdentityWarning["reason"]): ActivityIdentityWarning {
  return { recordIndex: indexed.recordIndex, reason, email: indexed.record.email, providerUserId: indexed.record.providerUserId };
}

export async function resolveActivityScopes(database: Matcher, companyIds: readonly string[], records: readonly ActivityIngestionRecord[]) {
  companyIds.forEach(validateUuid);
  const validated = validateRecords(records);
  const batches = new Map<string, ActivityIngestionRecord[]>();
  const warnings: ActivityIdentityWarning[] = [];
  for (const indexed of validated) {
    if (indexed.record.email === null) { warnings.push(warning(indexed, "missing_email")); continue; }
    let scope: string | undefined;
    for (const companyId of new Set(companyIds)) {
      if (await matchPerson(database, companyId, indexed.record.email)) {
        if (scope !== undefined) throw new Error("ACTIVITY_AMBIGUOUS_IDENTITY");
        scope = companyId;
      }
    }
    if (scope === undefined) warnings.push(warning(indexed, "unmatched_email"));
    else {
      const group = batches.get(scope) ?? [];
      group.push(indexed.record);
      batches.set(scope, group);
    }
  }
  return { batches: [...batches].map(([companyId, records]) => ({ companyId, records })), warnings };
}

export async function ingestActivityBatch(database: ActivityDatabase, batch: ActivityBatch): Promise<ActivityBatchResult> {
  validateUuid(batch.companyId); validateUuid(batch.vendorAccountId);
  if (batch.actorUserAccountId !== null) validateUuid(batch.actorUserAccountId);
  validateDate(batch.activityDate);
  if (!["api", "csv_import", "manual"].includes(batch.source)) throw new Error("ACTIVITY_INVALID_SOURCE");
  if (!(batch.syncedAt instanceof Date) || !Number.isFinite(batch.syncedAt.getTime())) throw new Error("ACTIVITY_INVALID_SYNC_TIME");
  const records = validateRecords(batch.records, batch.activityDate);
  return database.transaction(async (tx) => {
    // A shared row lock prevents disabling API ingestion while this transaction commits.
    const [account] = await tx.select({ mode: schema.vendorAccount.ingestionMode, identityMatching: schema.vendor.identityMatching })
      .from(schema.vendorAccount).innerJoin(schema.vendor, eq(schema.vendor.id, schema.vendorAccount.vendorId))
      .where(and(eq(schema.vendorAccount.id, batch.vendorAccountId), eq(schema.vendorAccount.status, "active"), eq(schema.vendor.status, "active")))
      .for("share", { of: [schema.vendorAccount, schema.vendor] });
    if (!account || account.identityMatching !== "email") throw new Error("ACTIVITY_ACCOUNT_UNSUPPORTED");
    const [company] = await tx.select({ id: schema.company.id }).from(schema.company).where(eq(schema.company.id, batch.companyId)).for("share");
    if (!company) throw new Error("ACTIVITY_COMPANY_NOT_FOUND");
    const actorId = batch.actorUserAccountId ?? SYSTEM_USER_ID;
    const [actor] = await tx.select({ id: schema.userAccount.id }).from(schema.userAccount)
      .where(and(eq(schema.userAccount.id, actorId), actorId === SYSTEM_USER_ID ? eq(schema.userAccount.email, SYSTEM_USER_EMAIL) : eq(schema.userAccount.status, "active"))).for("share");
    if (!actor) throw new Error("ACTIVITY_ACTOR_NOT_FOUND");
    let written = 0, ignored = 0;
    const warnings: ActivityIdentityWarning[] = [];
    if (batch.source === "api" && account.mode !== "api") ignored = records.length;
    else for (const indexed of records) {
      const record = indexed.record;
      if (record.email === null) { warnings.push(warning(indexed, "missing_email")); continue; }
      const holder = await matchPerson(tx, batch.companyId, record.email, true);
      if (!holder) { warnings.push(warning(indexed, "unmatched_email")); continue; }
      const rawPayload = { version: 1, vendorAccountId: batch.vendorAccountId, activityDate: batch.activityDate, source: batch.source,
        identity: { email: record.email, providerUserId: record.providerUserId }, counters: record.counters };
      const inserted = await tx.insert(schema.activityRecord).values({ vendorAccountId: batch.vendorAccountId, personId: holder.id,
        activityDate: batch.activityDate, counters: record.counters, rawPayload, source: batch.source, syncedAt: batch.syncedAt })
        .onConflictDoUpdate({ target: [schema.activityRecord.vendorAccountId, schema.activityRecord.personId, schema.activityRecord.activityDate],
          set: { counters: sql`excluded.counters`, rawPayload: sql`excluded.raw_payload`, source: sql`excluded.source`, syncedAt: sql`excluded.synced_at` },
          setWhere: sql`${schema.activityRecord.syncedAt} < excluded.synced_at` }).returning({ id: schema.activityRecord.id });
      if (inserted.length) written++;
      else {
        const [current] = await tx.select({ syncedAt: schema.activityRecord.syncedAt,
          equivalent: sql<boolean>`${schema.activityRecord.counters}=${JSON.stringify(record.counters)}::jsonb AND ${schema.activityRecord.rawPayload}=${JSON.stringify(rawPayload)}::jsonb AND ${schema.activityRecord.source}=${batch.source}` })
          .from(schema.activityRecord).innerJoin(schema.person, eq(schema.person.id, schema.activityRecord.personId))
          .where(and(eq(schema.person.companyId, batch.companyId), eq(schema.activityRecord.vendorAccountId, batch.vendorAccountId), eq(schema.activityRecord.personId, holder.id), eq(schema.activityRecord.activityDate, batch.activityDate)));
        if (!current || current.syncedAt.getTime() < batch.syncedAt.getTime()
          || (current.syncedAt.getTime() === batch.syncedAt.getTime() && !current.equivalent)) throw new Error("ACTIVITY_REPLAY_CONFLICT");
        ignored++;
      }
    }
    for (const item of warnings) await tx.insert(schema.auditLog).values({ actorUserId: actorId, action: "analytics_activity_warning", entityType: "VendorAccount",
      entityId: batch.vendorAccountId, companyId: batch.companyId, after: { vendorAccountId: batch.vendorAccountId, activityDate: batch.activityDate, source: batch.source, ...item }, occurredAt: batch.syncedAt });
    await tx.insert(schema.auditLog).values({ actorUserId: actorId, action: "analytics_activity_sync", entityType: "VendorAccount", entityId: batch.vendorAccountId,
      companyId: batch.companyId, after: { vendorAccountId: batch.vendorAccountId, activityDate: batch.activityDate, source: batch.source, written, ignored, warningCount: warnings.length }, occurredAt: batch.syncedAt });
    return { written, ignored, warnings };
  });
}
