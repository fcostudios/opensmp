/**
 * Role hierarchy (generated from the project nav-map RBAC — IMP-255).
 * Higher index = more permissions; the platform/operator role sees everything.
 */
export const ROLE_HIERARCHY = ["EMPLOYEE", "APPROVER", "COMPANY_FINANCE", "CENTRAL_FINANCE", "VIEWER", "GROUP_ADMIN"] as const;
export type AppRole = (typeof ROLE_HIERARCHY)[number];

/** Returns the highest role from an array of role strings. */
export function highestRole(roles: string[]): AppRole {
  const normalized = roles.map((r) => r.toLowerCase().replace("role_", ""));
  for (let i = ROLE_HIERARCHY.length - 1; i >= 0; i--) {
    if (normalized.includes(ROLE_HIERARCHY[i].toLowerCase())) {
      return ROLE_HIERARCHY[i];
    }
  }
  return "EMPLOYEE"; // least-privilege default
}

/** Check if a role has at least the given minimum role. */
export function hasMinRole(userRoles: string[], minRole: AppRole): boolean {
  const userHighest = ROLE_HIERARCHY.indexOf(highestRole(userRoles));
  const required = ROLE_HIERARCHY.indexOf(minRole);
  return userHighest >= required;
}

/** Nav items visible per minimum role. */
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  minRole: AppRole;
}
