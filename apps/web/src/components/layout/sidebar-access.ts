import {
  navItems,
  type NavItem,
} from "@/components/shell/nav-items.gen";

export function visibleNavItems(
  roles: readonly string[] | undefined,
): readonly NavItem[] {
  if (!roles || roles.length === 0) return [];
  const roleSet = new Set(roles);
  return navItems.filter(
    (item) =>
      item.roles !== undefined &&
      item.roles.some((role) => roleSet.has(role)),
  );
}
