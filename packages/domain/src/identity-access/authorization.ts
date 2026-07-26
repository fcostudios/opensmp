export type GlobalRole = "group_admin" | "central_finance";
export type CompanyRole = "approver" | "finance" | "viewer";
export type LedgerRole =
  | GlobalRole
  | "employee"
  | "approver"
  | "company_finance"
  | "viewer";

export interface CompanyGrant {
  readonly companyId: string;
  readonly role: CompanyRole;
}

export interface AuthorizationContext {
  readonly userAccountId: string;
  readonly idpSubject: string;
  readonly globalRole: GlobalRole | null;
  readonly companyGrants: readonly CompanyGrant[];
  readonly employeeCompanyId: string | null;
}

export type Capability =
  | "company:read"
  | "company:write"
  | "finance:read"
  | "finance:close"
  | "request:create"
  | "request:approve"
  | "audit:read"
  | "admin:manage";

export const ROLE_CAPABILITIES: Readonly<
  Record<LedgerRole, readonly Capability[]>
> = {
  group_admin: [
    "company:read",
    "company:write",
    "finance:read",
    "finance:close",
    "request:create",
    "request:approve",
    "audit:read",
    "admin:manage",
  ],
  central_finance: ["finance:read", "finance:close"],
  employee: ["request:create"],
  approver: ["company:read", "request:create", "request:approve"],
  company_finance: ["company:read", "finance:read"],
  viewer: ["company:read"],
} as const;

function roleForGrant(role: CompanyRole): LedgerRole {
  return role === "finance" ? "company_finance" : role;
}

function roleHasCapability(
  role: LedgerRole,
  capability: Capability,
): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function permittedCompanyIds(
  context: AuthorizationContext,
  capability: Capability,
): "all" | ReadonlySet<string> {
  if (
    context.globalRole &&
    roleHasCapability(context.globalRole, capability)
  ) {
    return "all";
  }

  const companyIds = new Set<string>();
  if (
    context.employeeCompanyId &&
    roleHasCapability("employee", capability)
  ) {
    companyIds.add(context.employeeCompanyId);
  }
  for (const grant of context.companyGrants) {
    if (roleHasCapability(roleForGrant(grant.role), capability)) {
      companyIds.add(grant.companyId);
    }
  }
  return companyIds;
}

export function hasCapability(
  context: AuthorizationContext,
  capability: Capability,
  companyId?: string,
): boolean {
  const permitted = permittedCompanyIds(context, capability);
  if (permitted === "all") return true;
  return companyId === undefined
    ? permitted.size > 0
    : permitted.has(companyId);
}
