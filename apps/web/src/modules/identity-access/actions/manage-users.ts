"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth/auth-config";
import { ROUTE_SCR_USERS_ROLES } from "@/lib/routes";
import { createProductionUserAdminService } from "../server-authorization";

const uuid = z.string().uuid();
const note = z.string().trim().min(1);

function service() {
  return createProductionUserAdminService();
}

async function actorSubject(): Promise<string> {
  const session = await auth();
  if (!session?.user?.idpSubject) throw new Error("unauthorized");
  return session.user.idpSubject;
}

function nullable(value: FormDataEntryValue | null): string | null {
  const parsed = typeof value === "string" ? value.trim() : "";
  return parsed || null;
}

/** @read-only-action Delegates to userAdminService; its repository owns the audited transaction. */
export async function createUserAccount(formData: FormData): Promise<void> {
  const parsed = z.object({ email: z.string().email(), globalRole: z.enum(["group_admin", "central_finance"]).nullable(), personId: uuid.nullable(), note }).parse({
    email: formData.get("email"), globalRole: nullable(formData.get("globalRole")), personId: nullable(formData.get("personId")), note: formData.get("note"),
  });
  await service().createUser(await actorSubject(), { ...parsed, displayName: parsed.email });
  revalidatePath(ROUTE_SCR_USERS_ROLES);
}

/** @read-only-action Delegates to userAdminService; its repository owns the audited transaction. */
export async function disableUserAccount(formData: FormData): Promise<void> {
  const parsed = z.object({ userAccountId: uuid, companyId: uuid.nullable(), note }).parse({ ...Object.fromEntries(formData), companyId: nullable(formData.get("companyId")) });
  await service().disableUser(await actorSubject(), parsed);
  revalidatePath(ROUTE_SCR_USERS_ROLES);
}

/** @read-only-action Delegates to userAdminService; its repository owns the audited transaction. */
export async function resetTwoFactor(formData: FormData): Promise<void> {
  const parsed = z.object({ userAccountId: uuid, note }).parse(Object.fromEntries(formData));
  await service().resetTwoFactor(await actorSubject(), parsed);
  revalidatePath(ROUTE_SCR_USERS_ROLES);
}

/** @read-only-action Delegates to userAdminService; its repository owns the audited transaction. */
export async function addCompanyRole(formData: FormData): Promise<void> {
  const parsed = z.object({ userAccountId: uuid, companyId: uuid, role: z.enum(["approver", "finance", "viewer"]), validFrom: z.string().date().nullable(), validTo: z.string().date().nullable(), note }).parse({
    ...Object.fromEntries(formData), validFrom: nullable(formData.get("validFrom")), validTo: nullable(formData.get("validTo")),
  });
  await service().grantCompanyRole(await actorSubject(), parsed);
  revalidatePath(ROUTE_SCR_USERS_ROLES);
}

/** @read-only-action Delegates to the database's atomic audited revocation function. */
export async function removeCompanyRole(formData: FormData): Promise<void> {
  const parsed = z.object({ assignmentId: uuid, companyId: uuid, note }).parse(Object.fromEntries(formData));
  await service().removeCompanyRole(await actorSubject(), parsed);
  revalidatePath(ROUTE_SCR_USERS_ROLES);
}
