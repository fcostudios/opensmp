import { describe, expect, test } from "vitest";

import {
  createUserAccountInputSchema,
  disableUserAccountInputSchema,
  grantCompanyRoleInputSchema,
  removeCompanyRoleInputSchema,
  resetTwoFactorInputSchema,
} from "./identity-access";

const userAccountId = "00000000-0000-0000-0000-000000000101";
const companyId = "00000000-0000-0000-0000-000000000102";
const roleAssignmentId = "00000000-0000-0000-0000-000000000103";

describe("identity-access privileged command contracts", () => {
  test.each([
    [
      "create user",
      createUserAccountInputSchema,
      { email: "admin@example.com", displayName: "Admin", note: "   " },
    ],
    [
      "disable user",
      disableUserAccountInputSchema,
      { userAccountId, note: "   " },
    ],
    [
      "reset two-factor authentication",
      resetTwoFactorInputSchema,
      { userAccountId, note: "   " },
    ],
    [
      "grant company role",
      grantCompanyRoleInputSchema,
      {
        userAccountId,
        companyId,
        role: "approver",
        validFrom: null,
        validTo: null,
        note: "   ",
      },
    ],
    [
      "remove company role",
      removeCompanyRoleInputSchema,
      { roleAssignmentId, note: "   " },
    ],
  ])("rejects a blank audit note for %s", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  test.each(["approver", "finance", "viewer"] as const)(
    "accepts the %s company role",
    (role) => {
      expect(
        grantCompanyRoleInputSchema.safeParse({
          userAccountId,
          companyId,
          role,
          validFrom: null,
          validTo: null,
          note: "Approved by Group Admin",
        }).success,
      ).toBe(true);
    },
  );

  test("rejects every role outside the company-role vocabulary", () => {
    expect(
      grantCompanyRoleInputSchema.safeParse({
        userAccountId,
        companyId,
        role: "group_admin",
        validFrom: null,
        validTo: null,
        note: "Approved by Group Admin",
      }).success,
    ).toBe(false);
  });

  test("rejects a role grant whose validity ends before it begins", () => {
    const result = grantCompanyRoleInputSchema.safeParse({
        userAccountId,
        companyId,
        role: "viewer",
        validFrom: "2026-08-04",
        validTo: "2026-08-03",
        note: "Temporary access",
      });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        message: "validTo cannot precede validFrom",
        path: ["validTo"],
      }));
    }
  });

  test.each([
    [null, "2026-08-03"],
    ["2026-08-03", null],
    [null, null],
    ["2026-08-03", "2026-08-03"],
  ] as const)("accepts the inclusive and open validity interval %s to %s", (validFrom, validTo) => {
    expect(grantCompanyRoleInputSchema.safeParse({
      userAccountId,
      companyId,
      role: "viewer",
      validFrom,
      validTo,
      note: "Boundary contract",
    }).success).toBe(true);
  });

  test("normalizes account email/display name and enforces display-name boundaries", () => {
    expect(createUserAccountInputSchema.parse({
      email: "  ADMIN@EXAMPLE.COM  ",
      displayName: "  Admin User  ",
      note: "Provisioning approved",
    })).toMatchObject({ email: "admin@example.com", displayName: "Admin User" });
    expect(createUserAccountInputSchema.safeParse({
      email: "admin@example.com",
      displayName: "x".repeat(201),
      note: "Provisioning approved",
    }).success).toBe(false);
    expect(createUserAccountInputSchema.safeParse({
      email: "admin@example.com",
      displayName: "   ",
      note: "Provisioning approved",
    }).success).toBe(false);
  });
});
