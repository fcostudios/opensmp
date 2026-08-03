import { eq, sql } from "drizzle-orm";

// eslint-disable-next-line no-restricted-imports -- This repository owns the audited provider-operation transaction boundary.
import { auditLog, identityProviderOperation } from "@smp/db/schema";
import type { IdentityAccessDatabase } from "./repository";

export type ProviderOperationKind = "create_user" | "disable_user" | "reset_two_factor";

export function createProviderOperationRepository(database: IdentityAccessDatabase) {
  return {
    async request(input: {
      actorUserId: string;
      companyId: string | null;
      idempotencyKey: string;
      kind: ProviderOperationKind;
      occurredAt: Date;
      payload: Record<string, unknown>;
      targetUserAccountId: string | null;
    }) {
      return database.transaction(async (transaction) => {
        const [operation] = await transaction.insert(identityProviderOperation).values({
          actorUserId: input.actorUserId,
          companyId: input.companyId,
          createdAt: input.occurredAt,
          idempotencyKey: input.idempotencyKey,
          kind: input.kind,
          payload: input.payload,
          status: "pending",
          targetUserAccountId: input.targetUserAccountId,
        }).onConflictDoNothing({ target: identityProviderOperation.idempotencyKey }).returning();
        if (operation) {
          await transaction.insert(auditLog).values({
            action: "identity.provider_operation.requested",
            actorUserId: input.actorUserId,
            after: { kind: input.kind, status: "pending" },
            before: null,
            companyId: input.companyId,
            entityId: operation.id,
            entityType: "IdentityProviderOperation",
            note: typeof input.payload.note === "string" ? input.payload.note : null,
            occurredAt: input.occurredAt,
          });
          return operation;
        }
        const [existing] = await transaction.select().from(identityProviderOperation)
          .where(eq(identityProviderOperation.idempotencyKey, input.idempotencyKey)).limit(1);
        if (!existing) throw new Error("provider_operation_request_failed");
        return existing;
      });
    },

    async checkpointProviderApplied(id: string, providerSubject: string, attemptedAt: Date) {
      const [operation] = await database.update(identityProviderOperation).set({
        attemptCount: sql`${identityProviderOperation.attemptCount} + 1`,
        lastAttemptedAt: attemptedAt,
        nextRetryAt: null,
        providerSubject,
        status: "provider_applied",
      }).where(eq(identityProviderOperation.id, id)).returning();
      if (!operation) throw new Error("provider_operation_not_found");
      return operation;
    },

    async markCompensated(id: string, originalFailure: string, completedAt: Date) {
      await database.update(identityProviderOperation).set({ completedAt, originalFailure, status: "compensated" })
        .where(eq(identityProviderOperation.id, id));
    },

    async markCleanupPending(id: string, originalFailure: string, cleanupFailure: string, attemptedAt: Date) {
      await database.update(identityProviderOperation).set({
        cleanupFailure,
        lastAttemptedAt: attemptedAt,
        nextRetryAt: new Date(attemptedAt.getTime() + 60_000),
        originalFailure,
        status: "cleanup_pending",
      }).where(eq(identityProviderOperation.id, id));
    },

    async markRetryPending(id: string, originalFailure: string, attemptedAt: Date) {
      await database.update(identityProviderOperation).set({
        attemptCount: sql`${identityProviderOperation.attemptCount} + 1`,
        lastAttemptedAt: attemptedAt,
        nextRetryAt: new Date(attemptedAt.getTime() + 60_000),
        originalFailure,
        status: "pending",
      }).where(eq(identityProviderOperation.id, id));
    },
  };
}
