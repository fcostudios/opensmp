"use client";

import { useTranslations } from "next-intl";

import { logout } from "@/lib/auth/logout";
import { Breadcrumbs, type ShellBreadcrumb } from "./breadcrumbs";
import { LocaleSelector } from "./locale-selector";

export function Header({
  breadcrumbs,
  displayName,
  titleKey,
  updateLocaleAction,
}: {
  readonly breadcrumbs: readonly ShellBreadcrumb[];
  readonly displayName: string;
  readonly titleKey: string;
  readonly updateLocaleAction: Parameters<
    typeof LocaleSelector
  >[0]["updateLocaleAction"];
}) {
  const t = useTranslations();

  return (
    <header className="border-b border-border bg-surface px-3 py-3 sm:px-4 lg:px-5">
      <div className="mx-auto flex max-w-[1280px] items-start justify-between gap-4">
        <div className="min-w-0">
          <Breadcrumbs items={breadcrumbs} />
          <h1 className="mt-1 max-w-4xl font-display text-3xl font-black uppercase leading-none tracking-tight text-text-primary sm:text-4xl lg:text-5xl">
            {t(titleKey)}
          </h1>
        </div>
        <div
          aria-label={t("shell.userMenu")}
          className="hidden min-h-[var(--size-tap-target-min)] shrink-0 items-center gap-3 md:flex"
        >
          <LocaleSelector updateLocaleAction={updateLocaleAction} />
          <span className="max-w-48 truncate text-sm font-semibold text-text-secondary">
            {displayName}
          </span>
          <button
            type="button"
            data-testid="btn_logout"
            className="min-h-[var(--size-tap-target-min)] rounded-md border border-border px-3 text-sm font-semibold text-text-secondary outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            onClick={logout}
          >
            {t("auth.signOut")}
          </button>
        </div>
      </div>
    </header>
  );
}
