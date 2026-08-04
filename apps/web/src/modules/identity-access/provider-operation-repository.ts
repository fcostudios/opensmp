import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

// eslint-disable-next-line no-restricted-imports -- This repository owns the audited provider-operation transaction boundary.
import { auditLog, identityProviderOperation, userAccount } from "@smp/db/schema";
import type { IdentityAccessDatabase } from "./repository";

export type ProviderOperationKind = "create_user" | "disable_user" | "reset_two_factor";
export type ProviderOperation = typeof identityProviderOperation.$inferSelect;

function scopeMatches(companyId: string | null) {
  return sql`${identityProviderOperation.companyId} IS NOT DISTINCT FROM ${companyId}`;
}

function leaseMatches(leaseToken: string) {
  return eq(identityProviderOperation.leaseToken, leaseToken);
}

function assertSameRequest(
  existing: ProviderOperation,
  input: {
    actorUserId: string;
    companyId: string | null;
    kind: ProviderOperationKind;
    payload: Record<string, unknown>;
    targetUserAccountId: string | null;
  },
) {
  if (
    existing.actorUserId !== input.actorUserId ||
    existing.companyId !== input.companyId ||
    existing.kind !== input.kind ||
    existing.targetUserAccountId !== input.targetUserAccountId ||
    !isDeepStrictEqual(existing.payload, input.payload)
  ) {
    throw new Error("provider_operation_idempotency_mismatch");
  }
}

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
          nextRetryAt: input.occurredAt,
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
        assertSameRequest(existing, input);
        return existing;
      });
    },

    async loadScoped(id: string, companyId: string | null) {
      const [operation] = await database.select().from(identityProviderOperation)
        .where(and(eq(identityProviderOperation.id, id), scopeMatches(companyId))).limit(1);
      return operation ?? null;
    },

    async claimById(input: {
      id: string;
      companyId: string | null;
      claimedAt: Date;
      leaseExpiresAt: Date;
      leaseToken: string;
    }) {
      const [operation] = await database.update(identityProviderOperation).set({
        leaseExpiresAt: input.leaseExpiresAt,
        leaseToken: input.leaseToken,
      }).where(and(
        eq(identityProviderOperation.id, input.id),
        scopeMatches(input.companyId),
        inArray(identityProviderOperation.status, ["pending", "provider_applied", "cleanup_pending"]),
        or(isNull(identityProviderOperation.leaseToken), lte(identityProviderOperation.leaseExpiresAt, input.claimedAt)),
      )).returning();
      return operation ?? null;
    },

    async claimDue(input: {
      companyIds: readonly string[];
      claimedAt: Date;
      leaseExpiresAt: Date;
      leaseToken: string;
    }) {
      return database.transaction(async (transaction) => {
        const accessibleScope = input.companyIds.length === 0
          ? isNull(identityProviderOperation.companyId)
          : or(
              isNull(identityProviderOperation.companyId),
              inArray(identityProviderOperation.companyId, [...input.companyIds]),
            );
        const [candidate] = await transaction.select({
          companyId: identityProviderOperation.companyId,
          id: identityProviderOperation.id,
        })
          .from(identityProviderOperation)
          .where(and(
            accessibleScope,
            inArray(identityProviderOperation.status, ["pending", "provider_applied", "cleanup_pending"]),
            or(isNull(identityProviderOperation.nextRetryAt), lte(identityProviderOperation.nextRetryAt, input.claimedAt)),
            or(isNull(identityProviderOperation.leaseToken), lte(identityProviderOperation.leaseExpiresAt, input.claimedAt)),
          ))
          .orderBy(asc(identityProviderOperation.nextRetryAt), asc(identityProviderOperation.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!candidate) return null;
        const [claimed] = await transaction.update(identityProviderOperation).set({
          leaseExpiresAt: input.leaseExpiresAt,
          leaseToken: input.leaseToken,
        }).where(and(
          eq(identityProviderOperation.id, candidate.id),
          scopeMatches(candidate.companyId),
          inArray(identityProviderOperation.status, ["pending", "provider_applied", "cleanup_pending"]),
          or(isNull(identityProviderOperation.nextRetryAt), lte(identityProviderOperation.nextRetryAt, input.claimedAt)),
          or(isNull(identityProviderOperation.leaseToken), lte(identityProviderOperation.leaseExpiresAt, input.claimedAt)),
        )).returning();
        return claimed ?? null;
      });
    },

    async checkpointProviderApplied(input: {
      id: string;
      companyId: string | null;
      leaseToken: string;
      providerSubject: string;
      attemptedAt: Date;
    }) {
      const [operation] = await database.update(identityProviderOperation).set({
        attemptCount: sql`${identityProviderOperation.attemptCount} + 1`,
        lastAttemptedAt: input.attemptedAt,
        nextRetryAt: input.attemptedAt,
        providerSubject: input.providerSubject,
        status: "provider_applied",
      }).where(and(
        eq(identityProviderOperation.id, input.id),
        scopeMatches(input.companyId),
        leaseMatches(input.leaseToken),
        eq(identityProviderOperation.status, "pending"),
      )).returning();
      if (!operation) throw new Error("provider_operation_not_claimed");
      return operation;
    },

    async beginCompensation(input: {
      id: string;
      companyId: string | null;
      leaseToken: string;
      originalFailure: string;
      attemptedAt: Date;
    }) {
      const [operation] = await database.update(identityProviderOperation).set({
        lastAttemptedAt: input.attemptedAt,
        nextRetryAt: input.attemptedAt,
        originalFailure: input.originalFailure,
        status: "cleanup_pending",
      }).where(and(
        eq(identityProviderOperation.id, input.id),
        scopeMatches(input.companyId),
        leaseMatches(input.leaseToken),
        eq(identityProviderOperation.status, "provider_applied"),
      )).returning();
      return operation ?? null;
    },

    async markCompensated(input: {
      id: string;
      companyId: string | null;
      leaseToken: string;
      originalFailure: string;
      completedAt: Date;
    }) {
      const [operation] = await database.update(identityProviderOperation).set({
        completedAt: input.completedAt,
        leaseExpiresAt: null,
        leaseToken: null,
        nextRetryAt: null,
        originalFailure: input.originalFailure,
        status: "compensated",
      }).where(and(
        eq(identityProviderOperation.id, input.id),
        scopeMatches(input.companyId),
        leaseMatches(input.leaseToken),
        eq(identityProviderOperation.status, "cleanup_pending"),
      )).returning();
      if (!operation) throw new Error("provider_operation_not_claimed");
      return operation;
    },

    async markCleanupPending(input: {
      id: string;
      companyId: string | null;
      leaseToken: string;
      originalFailure: string;
      cleanupFailure: string;
      attemptedAt: Date;
    }) {
      const [operation] = await database.update(identityProviderOperation).set({
        cleanupFailure: input.cleanupFailure,
        lastAttemptedAt: input.attemptedAt,
        leaseExpiresAt: null,
        leaseToken: null,
        nextRetryAt: new Date(input.attemptedAt.getTime() + 60_000),
        originalFailure: input.originalFailure,
        status: "cleanup_pending",
      }).where(and(
        eq(identityProviderOperation.id, input.id),
        scopeMatches(input.companyId),
        leaseMatches(input.leaseToken),
        eq(identityProviderOperation.status, "cleanup_pending"),
      )).returning();
      if (!operation) throw new Error("provider_operation_not_claimed");
      return operation;
    },

    async markRetryPending(input: {
      id: string;
      companyId: string | null;
      leaseToken: string;
      originalFailure: string;
      attemptedAt: Date;
    }) {
      const [operation] = await database.update(identityProviderOperation).set({
        attemptCount: sql`${identityProviderOperation.attemptCount} + 1`,
        lastAttemptedAt: input.attemptedAt,
        leaseExpiresAt: null,
        leaseToken: null,
        nextRetryAt: new Date(input.attemptedAt.getTime() + 60_000),
        originalFailure: input.originalFailure,
        status: "pending",
      }).where(and(
        eq(identityProviderOperation.id, input.id),
        scopeMatches(input.companyId),
        leaseMatches(input.leaseToken),
        eq(identityProviderOperation.status, "pending"),
      )).returning();
      if (!operation) throw new Error("provider_operation_not_claimed");
      return operation;
    },

    async markFailed(input: {
      id: string;
      companyId: string | null;
      leaseToken: string;
      originalFailure: string;
      completedAt: Date;
    }) {
      const [operation] = await database.update(identityProviderOperation).set({
        completedAt: input.completedAt,
        leaseExpiresAt: null,
        leaseToken: null,
        nextRetryAt: null,
        originalFailure: input.originalFailure,
        status: "failed",
      }).where(and(
        eq(identityProviderOperation.id, input.id),
        scopeMatches(input.companyId),
        leaseMatches(input.leaseToken),
        inArray(identityProviderOperation.status, ["pending", "provider_applied", "cleanup_pending"]),
      )).returning();
      if (!operation) throw new Error("provider_operation_not_claimed");
      return operation;
    },

    async ledgerOwnsProviderSubject(providerSubject: string) {
      const [account] = await database.select({ id: userAccount.id }).from(userAccount)
        .where(eq(userAccount.idpSubject, providerSubject)).limit(1);
      return account !== undefined;
    },
  };
}
