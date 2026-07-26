"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  activeNavItemId,
  groupedVisibleNavItems,
} from "./sidebar-access";

export function Sidebar({
  pathname,
  roles,
}: {
  readonly pathname: string;
  readonly roles: readonly string[];
}) {
  const t = useTranslations();
  const sections = groupedVisibleNavItems(roles);
  const activeItemId = activeNavItemId(pathname);

  return (
    <aside
      data-testid="desktop-rail"
      className="flex h-dvh w-16 flex-col border-r border-chrome-border bg-chrome-bg text-chrome-fg lg:w-[248px]"
    >
      <div className="flex min-h-16 items-center justify-center border-b border-chrome-border px-2 lg:justify-start lg:px-4">
        <span
          aria-label={t("app_name")}
          className="font-display text-2xl font-black uppercase tracking-tight"
        >
          <span aria-hidden className="lg:hidden">
            {t("app_name").slice(0, 1)}
          </span>
          <span aria-hidden className="hidden lg:inline">
            {t("app_name")}
          </span>
        </span>
      </div>
      <nav
        aria-label={t("shell.mainNavigation")}
        className="flex-1 overflow-y-auto px-2 py-3"
      >
        {sections.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`rail-section-${section.id}`}
            className="mb-4"
          >
            <h2
              id={`rail-section-${section.id}`}
              className="sr-only px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.06em] text-primary lg:not-sr-only"
            >
              {t(`shell.${section.id}`)}
            </h2>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.id === activeItemId;
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-[var(--size-tap-target-min)] items-center justify-center gap-3 rounded-md px-2 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-chrome-bg lg:justify-start lg:px-3 ${
                        active
                          ? "bg-chrome-active text-text-on-primary"
                          : "text-chrome-fg-muted hover:bg-chrome-border hover:text-chrome-fg"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="sr-only lg:not-sr-only">
                        {t(item.labelKey)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  );
}
