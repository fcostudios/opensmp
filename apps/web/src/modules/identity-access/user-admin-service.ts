import { createHash, randomUUID } from "node:crypto";
import { createUserAccountInputSchema } from "@smp/contracts";
import type { KeycloakAdminClient } from "./keycloak-admin";
import { createAuthorizationRepository } from "./authorization";
import {
  createUserAdministrationRepository,
  type CompanyRole,
  type GlobalRole,
  type IdentityAccessDatabase,
} from "./repository";
import {
  createProviderOperationRepository,
  type ProviderOperation,
} from "./provider-operation-repository";

export type UserAdminErrorCode =
  | "cross_company_target"
  | "forbidden"
  | "invalid_effective_dates"
  | "note_required"
  | "operation_in_progress"
  | "provider_email_conflict"
  | "target_not_found";

export class UserAdminError extends Error {
  constructor(readonly code: UserAdminErrorCode) {
    super(code);
    this.name = "UserAdminError";
  }
}

type CreateUserCommand = {
  email: string;
  displayName: string;
  globalRole: GlobalRole;
  personId: string | null;
  note: string;
};

type CreateUserPayload = CreateUserCommand & { actorSubject: string };
type UserMutationPayload = {
  actorSubject: string;
  userAccountId: string;
  note: string;
};

const leaseDurationMs = 5 * 60_000;

function mandatoryNote(note: string): string {
  const value = note.trim();
  if (!value) throw new UserAdminError("note_required");
  if (value.length > 1_000) throw new UserAdminError("note_required");
  return value;
}

function operationKey(parts: readonly (string | null)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function normalizedCreatePayload(actorSubject: string, command: CreateUserCommand): CreateUserPayload {
  return {
    actorSubject,
    displayName: command.displayName.trim(),
    email: command.email.trim().toLowerCase(),
    globalRole: command.globalRole,
    note: mandatoryNote(command.note),
    personId: command.personId,
  };
}

function createOperationKey(payload: CreateUserPayload): string {
  return operationKey([
    "create_user",
    payload.actorSubject,
    payload.email,
    payload.displayName,
    payload.globalRole,
    payload.personId,
    payload.note,
  ]);
}

function parseCreatePayload(payload: unknown): CreateUserPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("provider_operation_payload_invalid");
  }
  const actorSubject = (payload as Record<string, unknown>).actorSubject;
  if (typeof actorSubject !== "string" || !actorSubject) {
    throw new Error("provider_operation_payload_invalid");
  }
  const command = createUserAccountInputSchema.safeParse(payload);
  if (!command.success) throw new Error("provider_operation_payload_invalid");
  return { actorSubject, ...command.data };
}

function parseUserMutationPayload(payload: unknown): UserMutationPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("provider_operation_payload_invalid");
  }
  const value = payload as Record<string, unknown>;
  if (
    typeof value.actorSubject !== "string" || !value.actorSubject ||
    typeof value.userAccountId !== "string" || !value.userAccountId ||
    typeof value.note !== "string" || !value.note
  ) {
    throw new Error("provider_operation_payload_invalid");
  }
  return {
    actorSubject: value.actorSubject,
    userAccountId: value.userAccountId,
    note: value.note,
  };
}

async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, project: (value: T) => Promise<R>): Promise<R[]> {
  const laneCount = Math.min(values.length, limit);
  const lanes = Array.from({ length: laneCount }, () => [] as Array<{ index: number; value: T }>);
  values.forEach((value, index) => lanes[index % laneCount]!.push({ index, value }));
  const results = new Array<R>(values.length);
  await Promise.all(lanes.map(async (lane) => {
    for (const { index, value } of lane) {
      results[index] = await project(value);
    }
  }));
  return results;
}

export function createUserAdminService(input: {
  database: IdentityAccessDatabase;
  keycloak: KeycloakAdminClient;
  newLeaseToken?: () => string;
  now?: () => Date;
}) {
  const authorizationRepository = createAuthorizationRepository(input.database);
  const repository = createUserAdministrationRepository(input.database);
  const operations = createProviderOperationRepository(input.database);
  const now = input.now ?? (() => new Date());
  const newLeaseToken = input.newLeaseToken ?? randomUUID;

  async function requireGroupAdmin(subject: string) {
    const authorization = await authorizationRepository.load({ subject });
    if (!authorization || authorization.globalRole !== "group_admin") {
      throw new UserAdminError("forbidden");
    }
    return authorization;
  }

  function mapTargetError(error: unknown): never {
    if (error instanceof Error && error.message === "cross_company_target") {
      throw new UserAdminError("cross_company_target");
    }
    if (error instanceof Error && error.message === "user_not_found") {
      throw new UserAdminError("target_not_found");
    }
    throw error;
  }

  async function claimRequested(operation: ProviderOperation, claimedAt: Date) {
    if (operation.status === "completed") return null;
    if (operation.status === "compensated" || operation.status === "failed") {
      throw new Error(operation.originalFailure ?? "Provider operation cannot be retried");
    }
    const leaseToken = newLeaseToken();
    const claimed = await operations.claimById({
      id: operation.id,
      companyId: operation.companyId,
      claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + leaseDurationMs),
      leaseToken,
    });
    if (!claimed) throw new UserAdminError("operation_in_progress");
    return claimed;
  }

  async function reconcileCleanup(
    operation: ProviderOperation,
    payload: CreateUserPayload,
    leaseToken: string,
    attemptedAt: Date,
  ): Promise<never> {
    const original = new Error(operation.originalFailure ?? "Ledger finalization failed");
    const providerSubject = operation.providerSubject;
    if (!providerSubject) {
      await operations.markFailed({
        id: operation.id,
        companyId: operation.companyId,
        leaseToken,
        originalFailure: "provider_cleanup_subject_missing",
        completedAt: attemptedAt,
      });
      throw original;
    }
    const [ledgerOwnsSubject, providerUser] = await Promise.all([
      operations.ledgerOwnsProviderSubject(providerSubject),
      input.keycloak.findUserByEmail(payload.email),
    ]);
    if (
      ledgerOwnsSubject ||
      (providerUser !== null && (
        providerUser.idpSubject !== providerSubject ||
        providerUser.provisioningOperationId !== operation.id
      ))
    ) {
      await operations.markFailed({
        id: operation.id,
        companyId: operation.companyId,
        leaseToken,
        originalFailure: ledgerOwnsSubject
          ? "provider_cleanup_blocked_by_ledger_owner"
          : "provider_cleanup_ownership_mismatch",
        completedAt: attemptedAt,
      });
      throw original;
    }
    try {
      if (providerUser) await input.keycloak.deleteUser(providerSubject);
      await operations.markCompensated({
        id: operation.id,
        companyId: operation.companyId,
        leaseToken,
        originalFailure: operation.originalFailure ?? "Ledger finalization failed",
        completedAt: attemptedAt,
      });
    } catch (cleanupError) {
      try {
        await operations.markCleanupPending({
          id: operation.id,
          companyId: operation.companyId,
          leaseToken,
          originalFailure: String(original),
          cleanupFailure: String(cleanupError),
          attemptedAt,
        });
      } catch (recordingError) {
        throw new AggregateError([original, cleanupError, recordingError], "Keycloak cleanup and reconciliation checkpoint failed");
      }
      throw new AggregateError([original, cleanupError], "Keycloak user cleanup retry failed");
    }
    throw original;
  }

  async function executeCreate(
    operation: ProviderOperation,
    permittedCompanyIds: readonly string[],
    attemptedAt: Date,
  ) {
    const payload = parseCreatePayload(operation.payload);
    const leaseToken = operation.leaseToken;
    if (!leaseToken) throw new Error("provider_operation_not_claimed");
    if (operation.status === "cleanup_pending") {
      return reconcileCleanup(operation, payload, leaseToken, attemptedAt);
    }
    let providerSubject = operation.providerSubject;
    if (operation.status === "pending") {
      try {
        const existing = await input.keycloak.findUserByEmail(payload.email);
        if (existing && existing.provisioningOperationId !== operation.id) {
          await operations.markFailed({
            id: operation.id,
            companyId: operation.companyId,
            leaseToken,
            originalFailure: "provider_email_conflict",
            completedAt: attemptedAt,
          });
          throw new UserAdminError("provider_email_conflict");
        }
        const created = existing ?? await input.keycloak.createUser({
          email: payload.email,
          displayName: payload.displayName,
          provisioningOperationId: operation.id,
        });
        providerSubject = created.idpSubject;
        if (payload.globalRole) {
          await input.keycloak.addUserToPlatformAdmin(providerSubject);
        }
        await operations.checkpointProviderApplied({
          id: operation.id,
          companyId: operation.companyId,
          leaseToken,
          providerSubject,
          attemptedAt,
        });
      } catch (error) {
        if (error instanceof UserAdminError) throw error;
        await operations.markRetryPending({
          id: operation.id,
          companyId: operation.companyId,
          leaseToken,
          originalFailure: String(error),
          attemptedAt,
        });
        throw error;
      }
    }
    if (!providerSubject) throw new Error("provider_operation_subject_missing");
    try {
      return await repository.createUserAccount({
        actorUserId: operation.actorUserId,
        email: payload.email,
        globalRole: payload.globalRole,
        idpSubject: providerSubject,
        leaseToken,
        note: payload.note,
        operationCompanyId: operation.companyId,
        operationId: operation.id,
        occurredAt: attemptedAt,
        personId: payload.personId,
        permittedCompanyIds,
      });
    } catch (error) {
      const cleanup = await operations.beginCompensation({
        id: operation.id,
        companyId: operation.companyId,
        leaseToken,
        originalFailure: String(error),
        attemptedAt,
      });
      if (!cleanup) {
        const current = await operations.loadScoped(operation.id, operation.companyId);
        const account = await repository.findUserByEmail(payload.email);
        if (current?.status === "completed" && account) return account;
        throw error;
      }
      return reconcileCleanup(cleanup, payload, leaseToken, attemptedAt);
    }
  }

  async function executeUserMutation(operation: ProviderOperation, attemptedAt: Date) {
    const payload = parseUserMutationPayload(operation.payload);
    const leaseToken = operation.leaseToken;
    if (!leaseToken) throw new Error("provider_operation_not_claimed");
    const target = await repository.resolveUserTarget(payload.userAccountId);
    if (!target) {
      await operations.markFailed({
        id: operation.id,
        companyId: operation.companyId,
        leaseToken,
        originalFailure: "target_not_found",
        completedAt: attemptedAt,
      });
      throw new UserAdminError("target_not_found");
    }
    if (target.companyId !== operation.companyId) {
      await operations.markFailed({
        id: operation.id,
        companyId: operation.companyId,
        leaseToken,
        originalFailure: "cross_company_target",
        completedAt: attemptedAt,
      });
      throw new UserAdminError("cross_company_target");
    }
    if (operation.status === "pending") {
      try {
        if (operation.kind === "disable_user") {
          await input.keycloak.disableUser(target.idpSubject);
          await input.keycloak.revokeSessions(target.idpSubject);
        } else if (operation.kind === "reset_two_factor") {
          const credentials = await input.keycloak.listOtpCredentials(target.idpSubject);
          for (const credential of credentials) {
            await input.keycloak.removeOtpCredential(target.idpSubject, credential.id);
          }
          await input.keycloak.addRequiredAction(target.idpSubject, "CONFIGURE_TOTP");
        } else {
          throw new Error("provider_operation_kind_invalid");
        }
        await operations.checkpointProviderApplied({
          id: operation.id,
          companyId: operation.companyId,
          leaseToken,
          providerSubject: target.idpSubject,
          attemptedAt,
        });
      } catch (error) {
        await operations.markRetryPending({
          id: operation.id,
          companyId: operation.companyId,
          leaseToken,
          originalFailure: String(error),
          attemptedAt,
        });
        mapTargetError(error);
      }
    }
    return repository.finalizeUserMutation({
      action: operation.kind === "disable_user"
        ? "identity.user.disabled"
        : "identity.user.two_factor_reset",
      actorUserId: operation.actorUserId,
      companyId: operation.companyId,
      leaseToken,
      note: payload.note,
      operationId: operation.id,
      occurredAt: attemptedAt,
      statusBefore: target.status,
      userAccountId: payload.userAccountId,
    });
  }

  async function recoverDueOperations(actorSubject: string) {
    const authorization = await requireGroupAdmin(actorSubject);
    const claimedOperationIds = new Set<string>();
    async function drain(processed: number): Promise<number> {
      const claimedAt = now();
      const operation = await operations.claimDue({
        companyIds: authorization.companyIds,
        claimedAt,
        leaseExpiresAt: new Date(claimedAt.getTime() + leaseDurationMs),
        leaseToken: newLeaseToken(),
      });
      if (!operation) return processed;
      if (claimedOperationIds.has(operation.id)) {
        await operations.markRetryPending({
          id: operation.id,
          companyId: operation.companyId,
          leaseToken: operation.leaseToken!,
          originalFailure: operation.originalFailure ?? "provider_operation_recovery_stalled",
          attemptedAt: claimedAt,
        });
        return processed;
      }
      claimedOperationIds.add(operation.id);
      const operationKind = operation.kind;
      try {
        if (operationKind === "create_user") {
          await executeCreate(operation, authorization.companyIds, claimedAt);
        } else {
          await executeUserMutation(operation, claimedAt);
        }
      } catch (error) {
        if (error instanceof Error && error.message === "provider_operation_payload_invalid") {
          await operations.markFailed({
            id: operation.id,
            companyId: operation.companyId,
            leaseToken: operation.leaseToken!,
            originalFailure: error.message,
            completedAt: claimedAt,
          });
        }
        // Other execution failures record a terminal state or future retry before returning.
      }
      return drain(processed + 1);
    }
    return drain(0);
  }

  return {
    recoverDueOperations,

    async listUsers(actorSubject: string) {
      const authorization = await requireGroupAdmin(actorSubject);
      const users = await repository.listUsers(authorization.companyIds);
      return mapWithConcurrency(users, 8, async (user) => ({
        ...user,
        idpSubject: user.idpSubject!,
        twoFactorStatus: (await input.keycloak.listOtpCredentials(user.idpSubject!)).length > 0
          ? "configured" as const
          : "pending" as const,
      }));
    },

    async listCompanyRoles(actorSubject: string) {
      const authorization = await requireGroupAdmin(actorSubject);
      return repository.listCompanyRoles(authorization.companyIds);
    },

    async listCompanies(actorSubject: string) {
      const authorization = await requireGroupAdmin(actorSubject);
      return repository.listCompanies(authorization.companyIds);
    },

    async listAvailablePeople(actorSubject: string) {
      const authorization = await requireGroupAdmin(actorSubject);
      return repository.listAvailablePeople(authorization.companyIds);
    },

    async createUser(actorSubject: string, command: CreateUserCommand) {
      const authorization = await requireGroupAdmin(actorSubject);
      const payload = normalizedCreatePayload(actorSubject, command);
      const occurredAt = now();
      const operation = await operations.request({
        actorUserId: authorization.userAccountId,
        companyId: null,
        idempotencyKey: createOperationKey(payload),
        kind: "create_user",
        occurredAt,
        payload,
        targetUserAccountId: null,
      });
      if (operation.status === "completed") {
        const account = await repository.findUserByEmail(payload.email);
        if (account) return account;
      }
      const claimed = await claimRequested(operation, occurredAt);
      if (!claimed) throw new Error("completed provider operation has no Ledger account");
      return executeCreate(claimed, authorization.companyIds, occurredAt);
    },

    async disableUser(actorSubject: string, command: { userAccountId: string; note: string }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      const target = await repository.resolveUserTarget(command.userAccountId);
      if (!target) throw new UserAdminError("target_not_found");
      if (target.companyId && !authorization.companyIds.includes(target.companyId)) throw new UserAdminError("cross_company_target");
      const occurredAt = now();
      const payload: UserMutationPayload = { actorSubject, userAccountId: command.userAccountId, note };
      const operation = await operations.request({
        actorUserId: authorization.userAccountId,
        companyId: target.companyId,
        idempotencyKey: operationKey(["disable_user", actorSubject, command.userAccountId, note]),
        kind: "disable_user",
        occurredAt,
        payload,
        targetUserAccountId: command.userAccountId,
      });
      if (operation.status === "completed") return target;
      const claimed = await claimRequested(operation, occurredAt);
      if (!claimed) return target;
      await executeUserMutation(claimed, occurredAt);
      return target;
    },

    async resetTwoFactor(actorSubject: string, command: { userAccountId: string; note: string }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      const target = await repository.resolveUserTarget(command.userAccountId);
      if (!target) throw new UserAdminError("target_not_found");
      if (target.companyId && !authorization.companyIds.includes(target.companyId)) throw new UserAdminError("cross_company_target");
      const occurredAt = now();
      const payload: UserMutationPayload = { actorSubject, userAccountId: command.userAccountId, note };
      const operation = await operations.request({
        actorUserId: authorization.userAccountId,
        companyId: target.companyId,
        idempotencyKey: operationKey(["reset_two_factor", actorSubject, command.userAccountId, note]),
        kind: "reset_two_factor",
        occurredAt,
        payload,
        targetUserAccountId: command.userAccountId,
      });
      if (operation.status === "completed") return target;
      const claimed = await claimRequested(operation, occurredAt);
      if (!claimed) return target;
      await executeUserMutation(claimed, occurredAt);
      return target;
    },

    async grantCompanyRole(actorSubject: string, command: {
      userAccountId: string;
      companyId: string;
      role: CompanyRole;
      validFrom: string | null;
      validTo: string | null;
      note: string;
    }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      if (!authorization.companyIds.includes(command.companyId)) {
        throw new UserAdminError("cross_company_target");
      }
      if (command.validFrom && command.validTo && command.validFrom > command.validTo) {
        throw new UserAdminError("invalid_effective_dates");
      }
      try {
        return await repository.grantCompanyRole({
          ...command,
          actorUserId: authorization.userAccountId,
          note,
          occurredAt: now(),
        });
      } catch (error) {
        mapTargetError(error);
      }
    },

    async removeCompanyRole(actorSubject: string, command: { roleAssignmentId: string; note: string }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      const removed = await repository.removeCompanyRole({
        roleAssignmentId: command.roleAssignmentId,
        permittedCompanyIds: authorization.companyIds,
        actorUserId: authorization.userAccountId,
        note,
      });
      if (!removed) throw new UserAdminError("cross_company_target");
      return removed;
    },
  };
}

export type UserAdminService = ReturnType<typeof createUserAdminService>;
