import { describe, expect, test } from "vitest";

import {
  hasCapability,
  permittedCompanyIds,
  type AuthorizationContext,
  type Capability,
} from "./authorization";

const companyA = "00000000-0000-0000-0000-000000000801";
const companyB = "00000000-0000-0000-0000-000000000802";
const capabilities: readonly Capability[] = [
  "company:read",
  "company:write",
  "finance:read",
  "finance:close",
  "request:create",
  "request:approve",
  "audit:read",
  "admin:manage",
];

function context(
  overrides: Partial<AuthorizationContext>,
): AuthorizationContext {
  return {
    userAccountId: "00000000-0000-0000-0000-000000000810",
    idpSubject: "domain-authorization-subject",
    globalRole: null,
    companyGrants: [],
    employeeCompanyId: null,
    ...overrides,
  };
}

describe("explicit capability authorization", () => {
  test("group admin receives every capability globally", () => {
    const admin = context({ globalRole: "group_admin" });

    expect(
      capabilities.map((capability) => [
        capability,
        hasCapability(admin, capability),
        permittedCompanyIds(admin, capability),
      ]),
    ).toEqual(
      capabilities.map((capability) => [capability, true, "all"]),
    );
  });

  test("central finance receives only cross-company finance capabilities", () => {
    const finance = context({ globalRole: "central_finance" });

    expect(
      capabilities.filter((capability) =>
        hasCapability(finance, capability),
      ),
    ).toEqual(["finance:read", "finance:close"]);
    expect(permittedCompanyIds(finance, "finance:read")).toBe("all");
    expect(hasCapability(finance, "company:read", companyA)).toBe(false);
    expect(hasCapability(finance, "admin:manage")).toBe(false);
  });

  test("employee requester authority is restricted to the employee company", () => {
    const employee = context({ employeeCompanyId: companyA });

    expect(hasCapability(employee, "request:create", companyA)).toBe(true);
    expect(hasCapability(employee, "request:create", companyB)).toBe(false);
    expect(permittedCompanyIds(employee, "request:create")).toEqual(
      new Set([companyA]),
    );
    expect(hasCapability(employee, "company:read", companyA)).toBe(false);
  });

  test("company roles are nonhierarchical capability sets and viewer remains read-only", () => {
    const scoped = context({
      companyGrants: [
        { companyId: companyA, role: "approver" },
        { companyId: companyB, role: "finance" },
        { companyId: companyA, role: "viewer" },
      ],
    });

    expect(hasCapability(scoped, "request:approve", companyA)).toBe(true);
    expect(hasCapability(scoped, "request:approve", companyB)).toBe(false);
    expect(hasCapability(scoped, "finance:read", companyB)).toBe(true);
    expect(hasCapability(scoped, "finance:close", companyB)).toBe(false);
    expect(hasCapability(scoped, "company:read", companyA)).toBe(true);
    expect(hasCapability(scoped, "company:write", companyA)).toBe(false);
    expect(hasCapability(scoped, "request:create", companyA)).toBe(true);
    expect(permittedCompanyIds(scoped, "company:read")).toEqual(
      new Set([companyA, companyB]),
    );
  });
});
