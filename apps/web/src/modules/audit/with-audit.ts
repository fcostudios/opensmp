import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { AuditedMutationResult, AuditRecordInput } from "@smp/domain/audit";
import { auditLog } from "@smp/db/schema";
import * as schema from "@smp/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
const receiptBrand: unique symbol = Symbol("RecordedAuditReceipt");
export interface RecordedAuditReceipt {
  readonly [receiptBrand]: true;
}
export interface RecordedAuditExpectation {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly companyId: string | null;
  readonly after: unknown;
  readonly actorUserId?: string | null;
  readonly occurredAt?: Date;
}
type RecordedRow = typeof auditLog.$inferSelect;
const activeTransactions = new WeakSet<Transaction>();
const recordedReceipts = new WeakMap<RecordedAuditReceipt, {
  readonly transaction: Transaction;
  readonly row: RecordedRow;
}>();

function jsonbEqual(column: typeof auditLog.after | typeof auditLog.before, value: unknown) {
  if (value === null) return sql`${column} IS NULL`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("INVALID_RECORDED_AUDIT_EXPECTATION");
  return sql`${column} IS NOT DISTINCT FROM ${serialized}::jsonb`;
}

/** Verify independently supplied evidence inside the current withAudit transaction. */
export async function verifyRecordedAuditReceipt(
  transaction: Transaction,
  expected: RecordedAuditExpectation,
): Promise<RecordedAuditReceipt> {
  if (!activeTransactions.has(transaction)) throw new Error("INACTIVE_AUDIT_TRANSACTION");
  const conditions = [
    eq(auditLog.action, expected.action), eq(auditLog.entityType, expected.entityType),
    eq(auditLog.entityId, expected.entityId),
    sql`${auditLog.companyId} IS NOT DISTINCT FROM ${expected.companyId}::uuid`,
    jsonbEqual(auditLog.after, expected.after),
  ];
  if (expected.actorUserId !== undefined) conditions.push(
    sql`${auditLog.actorUserId} IS NOT DISTINCT FROM ${expected.actorUserId}::uuid`,
  );
  if (expected.occurredAt !== undefined) conditions.push(eq(auditLog.occurredAt, expected.occurredAt));
  const rows = await transaction.select().from(auditLog).where(and(...conditions));
  if (rows.length !== 1) throw new Error("RECORDED_AUDIT_NOT_FOUND");
  const receipt = Object.freeze({ [receiptBrand]: true as const });
  recordedReceipts.set(receipt, { transaction, row: rows[0]! });
  return receipt;
}

async function revalidateRecordedReceipt(transaction: Transaction, receipt: RecordedAuditReceipt) {
  const recorded = recordedReceipts.get(receipt);
  if (!recorded || recorded.transaction !== transaction || !activeTransactions.has(transaction)) {
    throw new Error("INVALID_RECORDED_AUDIT_RECEIPT");
  }
  const row = recorded.row;
  const rows = await transaction.select({ id: auditLog.id }).from(auditLog).where(and(
    eq(auditLog.id, row.id), eq(auditLog.action, row.action),
    eq(auditLog.entityType, row.entityType), eq(auditLog.entityId, row.entityId),
    sql`${auditLog.companyId} IS NOT DISTINCT FROM ${row.companyId}::uuid`,
    sql`${auditLog.actorUserId} IS NOT DISTINCT FROM ${row.actorUserId}::uuid`,
    sql`${auditLog.note} IS NOT DISTINCT FROM ${row.note}`,
    jsonbEqual(auditLog.before, row.before), jsonbEqual(auditLog.after, row.after),
    eq(auditLog.occurredAt, row.occurredAt),
  ));
  if (rows.length !== 1) throw new Error("RECORDED_AUDIT_CHANGED");
}

function ordinaryAudit(audit: AuditRecordInput | RecordedAuditReceipt): audit is AuditRecordInput {
  return typeof audit === "object" && audit !== null &&
    Object.hasOwn(audit, "action") && Object.hasOwn(audit, "entityType") &&
    Object.hasOwn(audit, "entityId") && Object.hasOwn(audit, "actorUserId") &&
    Object.hasOwn(audit, "companyId") && Object.hasOwn(audit, "before") &&
    Object.hasOwn(audit, "after") && Object.hasOwn(audit, "note");
}

type AfterCommitOptions<T> =
  | {
      readonly afterCommit?: undefined;
      readonly occurredAt?: Date;
    }
  | {
      readonly afterCommit: (value: T) => Promise<void>;
      readonly occurredAt?: Date;
      readonly onAfterCommitFailure: (
        error: unknown,
        value: T,
      ) => Promise<void>;
      readonly reportAfterCommitFailureHandlerError?: (
        code: "POST_COMMIT_FAILURE_HANDLER_FAILED",
      ) => void;
    };

const REDACTED = "[REDACTED]";
const secretKeys = new Set([
  "authorization",
  "encryptedsecret",
  "password",
  "secret",
  "token",
]);

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAuditValue);
  }
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof Date
  ) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      secretKeys.has(key.toLowerCase())
        ? REDACTED
        : redactAuditValue(nestedValue),
    ]),
  );
}

export async function withAudit<T>(
  database: Database,
  mutation: (
    transaction: Transaction,
  ) => Promise<AuditedMutationResult<T> | { readonly value: T; readonly audit: RecordedAuditReceipt }>,
  options: AfterCommitOptions<T> = {},
): Promise<T> {
  const occurredAt = options.occurredAt ?? new Date();
  const value = await database.transaction(async (transaction) => {
    activeTransactions.add(transaction);
    try {
      const { audit, value } = await mutation(transaction);
      if (ordinaryAudit(audit)) {
        await transaction.insert(auditLog).values({
          actorUserId: audit.actorUserId,
          action: audit.action,
          entityType: audit.entityType,
          entityId: audit.entityId,
          companyId: audit.companyId,
          note: audit.note,
          before: redactAuditValue(audit.before),
          after: redactAuditValue(audit.after),
          occurredAt,
        });
      } else {
        await revalidateRecordedReceipt(transaction, audit);
      }
      return value;
    } finally {
      activeTransactions.delete(transaction);
    }
  });
  if (options.afterCommit) {
    try {
      await options.afterCommit(value);
    } catch (error) {
      try {
        await options.onAfterCommitFailure(error, value);
      } catch {
        (
          options.reportAfterCommitFailureHandlerError ??
          ((code: "POST_COMMIT_FAILURE_HANDLER_FAILED") =>
            process.emitWarning(code))
        )("POST_COMMIT_FAILURE_HANDLER_FAILED");
      }
    }
  }
  return value;
}
