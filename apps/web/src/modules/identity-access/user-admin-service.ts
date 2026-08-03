import type { KeycloakAdminClient } from "./keycloak-admin";
import { createAuthorizationRepository } from "./authorization";
import {
  createUserAdministrationRepository,
  type CompanyRole,
  type GlobalRole,
  type IdentityAccessDatabase,
} from "./repository";

export type UserAdminErrorCode =
  | "cross_company_target"
  | "forbidden"
  | "invalid_effective_dates"
  | "note_required"
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
  return value;
}

export function createUserAdminService(input: {
  database: IdentityAccessDatabase;
  keycloak: KeycloakAdminClient;
  now?: () => Date;
}) {
  const authorizationRepository = createAuthorizationRepository(input.database);
  const repository = createUserAdministrationRepository(input.database);
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
      return Promise.all(users.map(async (user) => ({
        ...user,
        idpSubject: user.idpSubject!,
        twoFactorStatus: (await input.keycloak.listOtpCredentials(user.idpSubject!)).length > 0
          ? "configured" as const
          : "pending" as const,
      })));
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
      const createdInKeycloak = await input.keycloak.createUser({
        email: command.email.trim().toLowerCase(),
        displayName: command.displayName.trim(),
      });
      try {
        return await repository.createUserAccount({
          actorUserId: authorization.userAccountId,
          email: command.email.trim().toLowerCase(),
          globalRole: command.globalRole,
          idpSubject: createdInKeycloak.idpSubject,
          note,
          occurredAt: now(),
          personId: command.personId,
          permittedCompanyIds: authorization.companyIds,
        });
      } catch (error) {
        await input.keycloak.deleteUser(createdInKeycloak.idpSubject);
        throw error;
      }
    },

    async disableUser(actorSubject: string, command: {
      userAccountId: string;
      companyId: string | null;
      note: string;
    }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      if (command.companyId && !authorization.companyIds.includes(command.companyId)) {
        throw new UserAdminError("cross_company_target");
      }
      try {
        return await repository.mutateUser({
          action: "identity.user.disabled",
          actorUserId: authorization.userAccountId,
          companyId: command.companyId,
          mutateProvider: (idpSubject) => input.keycloak.disableUser(idpSubject),
          note,
          occurredAt: now(),
          userAccountId: command.userAccountId,
        });
      } catch (error) {
        mapTargetError(error);
      }
    },

    async resetTwoFactor(actorSubject: string, command: {
      userAccountId: string;
      note: string;
    }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      try {
        return await repository.mutateUser({
          action: "identity.user.two_factor_reset",
          actorUserId: authorization.userAccountId,
          mutateProvider: async (idpSubject) => {
            const credentials = await input.keycloak.listOtpCredentials(idpSubject);
            for (const credential of credentials) {
              await input.keycloak.removeOtpCredential(idpSubject, credential.id);
            }
            await input.keycloak.addRequiredAction(idpSubject, "CONFIGURE_TOTP");
          },
          note,
          occurredAt: now(),
          userAccountId: command.userAccountId,
        });
      } catch (error) {
        mapTargetError(error);
      }
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
      assignmentId: string;
      companyId: string;
      note: string;
    }) {
      const authorization = await requireGroupAdmin(actorSubject);
      const note = mandatoryNote(command.note);
      if (!authorization.companyIds.includes(command.companyId)) {
        throw new UserAdminError("cross_company_target");
      }
      const removed = await repository.removeCompanyRole({
        ...command,
        actorUserId: authorization.userAccountId,
        note,
      });
      if (!removed) throw new UserAdminError("cross_company_target");
      return removed;
    },
  };
}

export type UserAdminService = ReturnType<typeof createUserAdminService>;
