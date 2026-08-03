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
const personId = "00000000-0000-0000-0000-000000000104";

describe("identity-access privileged command contracts", () => {
  test.each([
    [
      "create user",
      createUserAccountInputSchema,
      { email: "admin@example.com", displayName: "Admin", globalRole: null, personId: null, note: "   " },
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
      globalRole: "group_admin",
      personId,
      note: "Provisioning approved",
    })).toEqual({
      email: "admin@example.com",
      displayName: "Admin User",
      globalRole: "group_admin",
      personId,
      note: "Provisioning approved",
    });
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

  test.each([
    ["create", createUserAccountInputSchema, { email: "admin@example.com", displayName: "Admin", globalRole: null, personId: null }],
    ["disable", disableUserAccountInputSchema, { userAccountId }],
    ["reset", resetTwoFactorInputSchema, { userAccountId }],
    ["grant", grantCompanyRoleInputSchema, { userAccountId, companyId, role: "viewer", validFrom: null, validTo: null }],
    ["remove", removeCompanyRoleInputSchema, { roleAssignmentId }],
  ])("caps the %s audit note at 1000 characters", (_name, schema, input) => {
    expect(schema.safeParse({ ...input, note: "n".repeat(1_000) }).success).toBe(true);
    expect(schema.safeParse({ ...input, note: "n".repeat(1_001) }).success).toBe(false);
  });

  test.each(["group_admin", "central_finance", null] as const)(
    "accepts the %s global role in the create command",
    (globalRole) => {
      expect(createUserAccountInputSchema.safeParse({
        email: "admin@example.com",
        displayName: "Admin",
        globalRole,
        personId: null,
        note: "Approved",
      }).success).toBe(true);
    },
  );

  test.each([
    ["disable", disableUserAccountInputSchema, { userAccountId, note: "  Disabled by operator  " }, { userAccountId, note: "Disabled by operator" }],
    ["reset", resetTwoFactorInputSchema, { userAccountId, note: "  Device replaced  " }, { userAccountId, note: "Device replaced" }],
    ["remove", removeCompanyRoleInputSchema, { roleAssignmentId, note: "  Assignment ended  " }, { roleAssignmentId, note: "Assignment ended" }],
  ])("normalizes the exact %s command", (_name, schema, input, expected) => {
    expect(schema.parse(input)).toEqual(expected);
  });

  test("normalizes the exact grant command without changing effective dates", () => {
    expect(grantCompanyRoleInputSchema.parse({
      userAccountId,
      companyId,
      role: "finance",
      validFrom: "2026-08-03",
      validTo: "2026-08-31",
      note: "  Month-end support  ",
    })).toEqual({
      userAccountId,
      companyId,
      role: "finance",
      validFrom: "2026-08-03",
      validTo: "2026-08-31",
      note: "Month-end support",
    });
  });

  test.each([
    ["create person", createUserAccountInputSchema, { email: "admin@example.com", displayName: "Admin", globalRole: null, personId: "not-a-uuid", note: "Approved" }],
    ["disable user", disableUserAccountInputSchema, { userAccountId: "not-a-uuid", note: "Approved" }],
    ["reset user", resetTwoFactorInputSchema, { userAccountId: "not-a-uuid", note: "Approved" }],
    ["grant user", grantCompanyRoleInputSchema, { userAccountId: "not-a-uuid", companyId, role: "viewer", validFrom: null, validTo: null, note: "Approved" }],
    ["grant company", grantCompanyRoleInputSchema, { userAccountId, companyId: "not-a-uuid", role: "viewer", validFrom: null, validTo: null, note: "Approved" }],
    ["remove assignment", removeCompanyRoleInputSchema, { roleAssignmentId: "not-a-uuid", note: "Approved" }],
  ])("rejects the invalid %s identifier", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  test.each([
    ["invalid email", { email: "not-an-email", displayName: "Admin", globalRole: null, personId: null, note: "Approved" }],
    ["unknown global role", { email: "admin@example.com", displayName: "Admin", globalRole: "viewer", personId: null, note: "Approved" }],
    ["display name above maximum", { email: "admin@example.com", displayName: "x".repeat(201), globalRole: null, personId: null, note: "Approved" }],
  ])("rejects create input with %s", (_name, input) => {
    expect(createUserAccountInputSchema.safeParse(input).success).toBe(false);
  });

  test("accepts the exact display-name maximum", () => {
    expect(createUserAccountInputSchema.parse({
      email: "admin@example.com",
      displayName: "x".repeat(200),
      globalRole: null,
      personId: null,
      note: "Approved",
    }).displayName).toHaveLength(200);
  });
});
