import { createHash } from "node:crypto";
import type { KeycloakAdminClient } from "./keycloak-admin";
import { createAuthorizationRepository } from "./authorization";
import {
  createUserAdministrationRepository,
  type CompanyRole,
  type GlobalRole,
  type IdentityAccessDatabase,
} from "./repository";
import { createProviderOperationRepository } from "./provider-operation-repository";

export type UserAdminErrorCode =
  | "cross_company_target"
  | "forbidden"
  | "invalid_effective_dates"
  | "note_required"
  | "provider_email_conflict"
  | "target_not_found";

export class UserAdminError extends Error {
  constructor(readonly code: UserAdminErrorCode) {
    super(code);
    this.name = "UserAdminError";
  }
}

function mandatoryNote(note: string): string {
  const value = note.trim();
  if (!value) throw new UserAdminError("note_required");
  if (value.length > 1_000) throw new UserAdminError("note_required");
  return value;
}

function operationKey(parts: readonly (string | null)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, project: (value: T) => Promise<R>): Promise<R[]> {
  const laneCount = values.length < limit ? values.length : limit;
  const lanes = Array.from({ length: laneCount }, () => [] as Array<{ index: number; value: T }>);
  values.forEach((value, index) => lanes[index % laneCount]!.push({ index, value }));
  const completed = await Promise.all(lanes.map(async (lane) => {
    const laneResults: Array<{ index: number; result: R }> = [];
    for (const { index, value } of lane) {
      laneResults.push({ index, result: await project(value) });
    }
    return laneResults;
  }));
  return completed.flat().sort((left, right) => left.index - right.index).map(({ result }) => result);
}

export function createUserAdminService(input: {
  database: IdentityAccessDatabase;
  keycloak: KeycloakAdminClient;
  now?: () => Date;
}) {
  const authorizationRepository = createAuthorizationRepository(input.database);
  const repository = createUserAdministrationRepository(input.database);
  const operations = createProviderOperationRepository(input.database);
  const now = input.now ?? (() => new Date());

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

  return {
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

    async createUser(actorSubject: string, command: {
      email: string;
      displayName: string;
      globalRole: GlobalRole;
      personId: string | null;
      note: string;
    }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      const occurredAt = now();
      const normalizedEmail = command.email.trim().toLowerCase();
      const operation = await operations.request({
        actorUserId: authorization.userAccountId,
        companyId: null,
        idempotencyKey: operationKey(["create_user", actorSubject, normalizedEmail, note]),
        kind: "create_user",
        occurredAt,
        payload: { ...command, email: normalizedEmail, note },
        targetUserAccountId: null,
      });
      if (operation.status === "completed") {
        const account = await repository.findUserByEmail(normalizedEmail);
        if (account) return account;
      }
      if (operation.status === "cleanup_pending" && operation.providerSubject) {
        const original = new Error(operation.originalFailure ?? "Ledger finalization failed");
        try {
          await input.keycloak.deleteUser(operation.providerSubject);
        } catch (cleanupError) {
          try {
            await operations.markCleanupPending(operation.id, String(original), String(cleanupError), occurredAt);
          } catch (recordingError) {
            throw new AggregateError([original, cleanupError, recordingError], "Keycloak cleanup and reconciliation checkpoint failed");
          }
          throw new AggregateError([original, cleanupError], "Keycloak user cleanup retry failed");
        }
        try {
          await operations.markCompensated(operation.id, operation.originalFailure ?? "Ledger finalization failed", occurredAt);
        } catch (recordingError) {
          throw new AggregateError([original, recordingError], "Provider cleanup succeeded but its reconciliation checkpoint failed");
        }
        throw original;
      }
      if (operation.status === "compensated" || operation.status === "failed") {
        throw new Error(operation.originalFailure ?? "Provider operation cannot be retried");
      }
      let createdInKeycloak: { idpSubject: string };
      if (operation.status === "provider_applied" && operation.providerSubject) {
        createdInKeycloak = { idpSubject: operation.providerSubject };
      } else {
        const existing = await input.keycloak.findUserByEmail(normalizedEmail);
        if (existing && existing.provisioningOperationId !== operation.id) {
          throw new UserAdminError("provider_email_conflict");
        }
        createdInKeycloak = existing ?? await input.keycloak.createUser({
          email: normalizedEmail,
          displayName: command.displayName.trim(),
          provisioningOperationId: operation.id,
        });
      }
      try {
        if (command.globalRole && operation.status !== "provider_applied") {
          await input.keycloak.addUserToPlatformAdmin(createdInKeycloak.idpSubject);
        }
        if (operation.status !== "provider_applied") {
          await operations.checkpointProviderApplied(operation.id, createdInKeycloak.idpSubject, occurredAt);
        }
        const created = await repository.createUserAccount({
          actorUserId: authorization.userAccountId,
          email: normalizedEmail,
          globalRole: command.globalRole,
          idpSubject: createdInKeycloak.idpSubject,
          note,
          operationId: operation.id,
          occurredAt,
          personId: command.personId,
          permittedCompanyIds: authorization.companyIds,
        });
        return created;
      } catch (error) {
        try {
          await input.keycloak.deleteUser(createdInKeycloak.idpSubject);
          await operations.markCompensated(operation.id, String(error), occurredAt);
        } catch (cleanupError) {
          try {
            await operations.markCleanupPending(operation.id, String(error), String(cleanupError), occurredAt);
          } catch (recordingError) {
            throw new AggregateError([error, cleanupError, recordingError], "Keycloak cleanup and reconciliation checkpoint failed");
          }
          throw new AggregateError([error, cleanupError], "Keycloak user cleanup failed after Ledger create failure");
        }
        throw error;
      }
    },

    async disableUser(actorSubject: string, command: {
      userAccountId: string;
      note: string;
    }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      const target = await repository.resolveUserTarget(command.userAccountId);
      if (!target) throw new UserAdminError("target_not_found");
      if (target.companyId && !authorization.companyIds.includes(target.companyId)) throw new UserAdminError("cross_company_target");
      const occurredAt = now();
      const operation = await operations.request({
        actorUserId: authorization.userAccountId,
        companyId: target.companyId,
        idempotencyKey: operationKey(["disable_user", actorSubject, command.userAccountId, note]),
        kind: "disable_user",
        occurredAt,
        payload: { ...command, note },
        targetUserAccountId: command.userAccountId,
      });
      if (operation.status === "completed") return target;
      try {
        await input.keycloak.disableUser(target.idpSubject);
        await input.keycloak.revokeSessions(target.idpSubject);
      } catch (error) {
        try {
          await operations.markRetryPending(operation.id, String(error), occurredAt);
        } catch (recordingError) {
          throw new AggregateError([error, recordingError], "Disable failed and retry metadata could not be recorded");
        }
        mapTargetError(error);
      }
      await operations.checkpointProviderApplied(operation.id, target.idpSubject, occurredAt);
      return repository.finalizeUserMutation({
        action: "identity.user.disabled", actorUserId: authorization.userAccountId,
        companyId: target.companyId, note, operationId: operation.id, occurredAt,
        statusBefore: target.status, userAccountId: command.userAccountId,
      });
    },

    async resetTwoFactor(actorSubject: string, command: {
      userAccountId: string;
      note: string;
    }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      const target = await repository.resolveUserTarget(command.userAccountId);
      if (!target) throw new UserAdminError("target_not_found");
      if (target.companyId && !authorization.companyIds.includes(target.companyId)) throw new UserAdminError("cross_company_target");
      const occurredAt = now();
      const operation = await operations.request({ actorUserId: authorization.userAccountId, companyId: target.companyId,
        idempotencyKey: operationKey(["reset_two_factor", actorSubject, command.userAccountId, note]), kind: "reset_two_factor",
        occurredAt, payload: { ...command, note }, targetUserAccountId: command.userAccountId });
      if (operation.status === "completed") return target;
      try {
        const credentials = await input.keycloak.listOtpCredentials(target.idpSubject);
        for (const credential of credentials) {
          await input.keycloak.removeOtpCredential(target.idpSubject, credential.id);
        }
        await input.keycloak.addRequiredAction(target.idpSubject, "CONFIGURE_TOTP");
      } catch (error) {
        try {
          await operations.markRetryPending(operation.id, String(error), occurredAt);
        } catch (recordingError) {
          throw new AggregateError([error, recordingError], "Two-factor reset failed and retry metadata could not be recorded");
        }
        mapTargetError(error);
      }
      await operations.checkpointProviderApplied(operation.id, target.idpSubject, occurredAt);
      return repository.finalizeUserMutation({ action: "identity.user.two_factor_reset", actorUserId: authorization.userAccountId,
        companyId: target.companyId, note, operationId: operation.id, occurredAt, statusBefore: target.status, userAccountId: command.userAccountId,
      });
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

    async removeCompanyRole(actorSubject: string, command: {
      roleAssignmentId: string;
      note: string;
    }) {
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
