"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { navItems } from "@/components/shell/nav-items.gen";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRoles = ((session?.user as { roles?: string[] } | undefined)?.roles) ?? [];
  const visible = navItems.filter(
    (item) =>
      !item.roles ||
      item.roles.length === 0 ||
      userRoles.length === 0 ||
      item.roles.some((r) => userRoles.includes(r)),
  );
  return (
    <aside className="hidden md:flex w-60 flex-col border-r bg-white">
      <div className="flex h-14 items-center px-4 font-bold text-lg">
        Ledger
      </div>
      <nav className="flex-1 space-y-1 px-2 py-4">
        {visible.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          // Active-nav color is data-driven from the project's primary
          // token (apps/web/src/styles/tokens.css), NOT a hardcoded hue —
          // the design system owns the brand color (IMP-241).
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                active ? "font-medium" : "text-gray-700 hover:bg-gray-100"
              }`}
              style={
                active
                  ? { color: "var(--color-primary)", backgroundColor: "var(--color-primary-soft)" }
                  : undefined
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
