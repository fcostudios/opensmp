import { z } from "zod";

const auditNoteSchema = () => z.string().trim().min(1).max(1_000);
const userAccountIdSchema = () => z.string().uuid();

export const createUserAccountInputSchema = z.lazy(() => z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(1).max(200),
  globalRole: z.enum(["group_admin", "central_finance"]).nullable(),
  personId: z.string().uuid().nullable(),
  note: auditNoteSchema(),
}));

export type CreateUserAccountInput = z.infer<
  typeof createUserAccountInputSchema
>;

export const disableUserAccountInputSchema = z.lazy(() => z.object({
  userAccountId: userAccountIdSchema(),
  note: auditNoteSchema(),
}));

export type DisableUserAccountInput = z.infer<
  typeof disableUserAccountInputSchema
>;

export const resetTwoFactorInputSchema = z.lazy(() => z.object({
  userAccountId: userAccountIdSchema(),
  note: auditNoteSchema(),
}));

export type ResetTwoFactorInput = z.infer<typeof resetTwoFactorInputSchema>;

export const grantCompanyRoleInputSchema = z.lazy(() => z
  .object({
    userAccountId: userAccountIdSchema(),
    companyId: z.string().uuid(),
    role: z.enum(["approver", "finance", "viewer"]),
    validFrom: z.string().date().nullable(),
    validTo: z.string().date().nullable(),
    note: auditNoteSchema(),
  })
  .refine(
    ({ validFrom, validTo }) =>
      validFrom === null || validTo === null || validTo >= validFrom,
    { message: "validTo cannot precede validFrom", path: ["validTo"] },
  ));

export type GrantCompanyRoleInput = z.infer<
  typeof grantCompanyRoleInputSchema
>;

export const removeCompanyRoleInputSchema = z.lazy(() => z.object({
  roleAssignmentId: z.string().uuid(),
  note: auditNoteSchema(),
}));

export type RemoveCompanyRoleInput = z.infer<
  typeof removeCompanyRoleInputSchema
>;
