import { eq, or, sql } from "drizzle-orm";

import { auditLog, userAccount } from "@smp/db/schema";

import type { ImportDatabase } from "./company-import-transaction";
import type { GoLiveImportInput } from "./register-backfill-transaction";

export const GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION =
  "go_live_operator.actor_bootstrapped";
export const GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_NOTE =
  "US-007 local operator actor bootstrap";

export interface OperatorActor {
  readonly id: string;
  readonly email: string;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function ensureOperatorActor(
  transaction: Parameters<Parameters<ImportDatabase["transaction"]>[0]>[0],
  actor: OperatorActor,
  occurredAt: Date,
): Promise<void> {
  const matches = await transaction
    .select()
    .from(userAccount)
    .where(or(eq(userAccount.id, actor.id), eq(userAccount.email, actor.email)));
  if (matches.length === 0) {
    await transaction.insert(userAccount).values({
      id: actor.id,
      email: actor.email,
      globalRole: "group_admin",
      status: "active",
      createdAt: occurredAt,
    });
    await transaction.insert(auditLog).values({
      actorUserId: null,
      action: GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION,
      entityType: "UserAccount",
      entityId: actor.id,
      companyId: null,
      note: GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_NOTE,
      before: null,
      after: {
        email: actor.email,
        global_role: "group_admin",
        status: "active",
      },
      occurredAt,
    });
    return;
  }
  assertCondition(
    matches.length === 1 &&
      matches[0]?.id === actor.id &&
      matches[0].email === actor.email &&
      matches[0].globalRole === "group_admin" &&
      matches[0].status === "active",
    "Deterministic import actor conflicts with an existing account",
  );
}

export async function runLockedGoLiveOperatorImport(
  database: ImportDatabase,
  input: GoLiveImportInput,
  actor: OperatorActor,
) {
  assertCondition(
    input.actorUserId === actor.id,
    "Operator actor does not match the prepared import",
  );
  const occurredAt = input.occurredAt ?? new Date();
  const {
    auditedGoLiveImportBoundary,
    GO_LIVE_IMPORT_LOCK,
  } = await import("./register-backfill-transaction");
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${GO_LIVE_IMPORT_LOCK}, 0))`,
    );
    await ensureOperatorActor(transaction, actor, occurredAt);
    return auditedGoLiveImportBoundary.run(
      transaction as unknown as ImportDatabase,
      input,
    );
  });
}
