import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { AuditedMutationResult } from "@smp/domain/audit";
import { auditLog } from "@smp/db/schema";
import * as schema from "@smp/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

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
  ) => Promise<AuditedMutationResult<T>>,
  {
    occurredAt = new Date(),
  }: {
    readonly occurredAt?: Date;
  } = {},
): Promise<T> {
  return database.transaction(async (transaction) => {
    const { audit, value } = await mutation(transaction);
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
    return value;
  });
}
