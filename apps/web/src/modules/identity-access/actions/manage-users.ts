import { revalidatePath } from "next/cache";
import {
  createUserAccountInputSchema,
  disableUserAccountInputSchema,
  grantCompanyRoleInputSchema,
  removeCompanyRoleInputSchema,
  resetTwoFactorInputSchema,
} from "@smp/contracts";
import { ROUTE_SCR_USERS_ROLES } from "@/lib/routes";
import type { createUserAdminService } from "../user-admin-service";

async function service(): Promise<UserAdminService> {
  const { createProductionUserAdminService } = await import("../server-authorization");
  return createProductionUserAdminService();
}

async function actorSubject(): Promise<string> {
  const { auth } = await import("@/lib/auth/auth-config");
  const session = await auth();
  if (!session?.user?.idpSubject) throw new Error("unauthorized");
  return session.user.idpSubject;
}

function nullable(value: FormDataEntryValue | null): string | null {
  const parsed = typeof value === "string" ? value.trim() : "";
  return parsed || null;
}

type UserAdminService = ReturnType<typeof createUserAdminService>;

export function createManageUserActionHandlers(dependencies: {
  readonly actorSubject: () => Promise<string>;
  readonly revalidate: (path: string) => void;
  readonly service: () => UserAdminService | Promise<UserAdminService>;
}) {
  return {
    async createUserAccount(formData: FormData): Promise<void> {
      const parsed = createUserAccountInputSchema.parse({
        email: formData.get("email"), displayName: formData.get("displayName"), globalRole: nullable(formData.get("globalRole")), personId: nullable(formData.get("personId")), note: formData.get("note"),
      });
      await (await dependencies.service()).createUser(await dependencies.actorSubject(), parsed);
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
    async disableUserAccount(formData: FormData): Promise<void> {
      const parsed = disableUserAccountInputSchema.parse(Object.fromEntries(formData));
      await (await dependencies.service()).disableUser(await dependencies.actorSubject(), parsed);
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
    async resetTwoFactor(formData: FormData): Promise<void> {
      const parsed = resetTwoFactorInputSchema.parse(Object.fromEntries(formData));
      await (await dependencies.service()).resetTwoFactor(await dependencies.actorSubject(), parsed);
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
    async addCompanyRole(formData: FormData): Promise<void> {
      const parsed = grantCompanyRoleInputSchema.parse({
        ...Object.fromEntries(formData), validFrom: nullable(formData.get("validFrom")), validTo: nullable(formData.get("validTo")),
      });
      await (await dependencies.service()).grantCompanyRole(await dependencies.actorSubject(), parsed);
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
    async removeCompanyRole(formData: FormData): Promise<void> {
      const parsed = removeCompanyRoleInputSchema.parse(Object.fromEntries(formData));
      await (await dependencies.service()).removeCompanyRole(await dependencies.actorSubject(), parsed);
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
  };
}

const handlers = createManageUserActionHandlers({
  actorSubject,
  revalidate: revalidatePath,
  service,
});

/** @read-only-action Delegates to userAdminService; its repository owns the audited transaction. */
export async function createUserAccount(formData: FormData): Promise<void> {
  "use server";
  return handlers.createUserAccount(formData);
}

/** @read-only-action Delegates to userAdminService; its repository owns the audited transaction. */
export async function disableUserAccount(formData: FormData): Promise<void> {
  "use server";
  return handlers.disableUserAccount(formData);
}

/** @read-only-action Delegates to userAdminService; its repository owns the audited transaction. */
export async function resetTwoFactor(formData: FormData): Promise<void> {
  "use server";
  return handlers.resetTwoFactor(formData);
}

/** @read-only-action Delegates to userAdminService; its repository owns the audited transaction. */
export async function addCompanyRole(formData: FormData): Promise<void> {
  "use server";
  return handlers.addCompanyRole(formData);
}

/** @read-only-action Delegates to the database's atomic audited revocation function. */
export async function removeCompanyRole(formData: FormData): Promise<void> {
  "use server";
  return handlers.removeCompanyRole(formData);
}
