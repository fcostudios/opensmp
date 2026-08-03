import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROUTE_SCR_USERS_ROLES } from "@/lib/routes";
import type { createUserAdminService } from "../user-admin-service";

const uuid = z.string().uuid();
const note = z.string().trim().min(1);

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
      const parsed = z.object({ email: z.string().email(), globalRole: z.enum(["group_admin", "central_finance"]).nullable(), personId: uuid.nullable(), note }).parse({
        email: formData.get("email"), globalRole: nullable(formData.get("globalRole")), personId: nullable(formData.get("personId")), note: formData.get("note"),
      });
      await (await dependencies.service()).createUser(await dependencies.actorSubject(), { ...parsed, displayName: parsed.email });
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
    async disableUserAccount(formData: FormData): Promise<void> {
      const parsed = z.object({ userAccountId: uuid, companyId: uuid.nullable(), note }).parse({ ...Object.fromEntries(formData), companyId: nullable(formData.get("companyId")) });
      await (await dependencies.service()).disableUser(await dependencies.actorSubject(), parsed);
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
    async resetTwoFactor(formData: FormData): Promise<void> {
      const parsed = z.object({ userAccountId: uuid, note }).parse(Object.fromEntries(formData));
      await (await dependencies.service()).resetTwoFactor(await dependencies.actorSubject(), parsed);
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
    async addCompanyRole(formData: FormData): Promise<void> {
      const parsed = z.object({ userAccountId: uuid, companyId: uuid, role: z.enum(["approver", "finance", "viewer"]), validFrom: z.string().date().nullable(), validTo: z.string().date().nullable(), note }).parse({
        ...Object.fromEntries(formData), validFrom: nullable(formData.get("validFrom")), validTo: nullable(formData.get("validTo")),
      });
      await (await dependencies.service()).grantCompanyRole(await dependencies.actorSubject(), parsed);
      dependencies.revalidate(ROUTE_SCR_USERS_ROLES);
    },
    async removeCompanyRole(formData: FormData): Promise<void> {
      const parsed = z.object({ assignmentId: uuid, companyId: uuid, note }).parse(Object.fromEntries(formData));
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
