import {
  navItems,
  navSections,
  type NavItem,
  type NavSectionId,
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

export interface VisibleNavSection {
  readonly id: NavSectionId;
  readonly items: readonly NavItem[];
}

export function groupedVisibleNavItems(
  roles: readonly string[] | undefined,
): readonly VisibleNavSection[] {
  const visible = visibleNavItems(roles);
  return navSections.flatMap(({ id }) => {
    const items = visible.filter((item) => item.section === id);
    return items.length > 0 ? [{ id, items }] : [];
  });
}

export function activeNavItemId(pathname: string): string | null {
  const candidates = navItems
    .filter(
      ({ href }) =>
        pathname === href || pathname.startsWith(`${href}/`),
    )
    .sort((left, right) => right.href.length - left.href.length);
  return candidates[0]?.id ?? null;
}
