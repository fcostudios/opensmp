"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { logout } from "@/lib/auth/logout";
import {
  activeNavItemId,
  groupedVisibleNavItems,
} from "./sidebar-access";
import { LocaleSelector } from "./locale-selector";

const focusableSelector =
  'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileBar({
  displayName,
  pathname,
  roles,
  updateLocaleAction,
}: {
  readonly displayName: string;
  readonly pathname: string;
  readonly roles: readonly string[];
  readonly updateLocaleAction: Parameters<
    typeof LocaleSelector
  >[0]["updateLocaleAction"];
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sections = groupedVisibleNavItems(roles);
  const activeItemId = activeNavItemId(pathname);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstControl =
      sheetRef.current?.querySelector<HTMLElement>(focusableSelector);
    firstControl?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function closeSheet({ restoreFocus = true } = {}): void {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function keepFocusInSheet(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <header className="flex min-h-16 items-center justify-between border-b border-chrome-border bg-chrome-bg px-3 text-chrome-fg">
        <span className="font-display text-2xl font-black uppercase tracking-tight">
          {t("app_name")}
        </span>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-navigation-sheet"
          className="flex min-h-[var(--size-tap-target-min)] min-w-[var(--size-tap-target-min)] flex-col items-center justify-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-chrome-bg"
          onClick={() => setOpen(true)}
        >
          <span className="sr-only">{t("shell.menu")}</span>
          <span aria-hidden className="h-0.5 w-5 bg-chrome-fg" />
          <span aria-hidden className="h-0.5 w-5 bg-chrome-fg" />
          <span aria-hidden className="h-0.5 w-5 bg-chrome-fg" />
        </button>
      </header>

      <div
        className="fixed inset-0 z-50 md:hidden"
        hidden={!open}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("shell.closeMenu")}
          className="absolute inset-0 bg-chrome-bg/70"
          onClick={() => closeSheet()}
        />
        <div
          ref={sheetRef}
          id="mobile-navigation-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t("shell.mobileNavigation")}
          className="absolute inset-y-0 right-0 flex w-[min(22rem,calc(100%-2rem))] flex-col bg-chrome-bg text-chrome-fg shadow-lg"
          onKeyDown={keepFocusInSheet}
        >
          <div className="flex min-h-16 items-center justify-between border-b border-chrome-border px-3">
            <strong className="font-display text-xl uppercase">
              {t("shell.menu")}
            </strong>
            <button
              type="button"
              className="min-h-[var(--size-tap-target-min)] rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => closeSheet()}
            >
              {t("shell.closeMenu")}
            </button>
          </div>
          <nav
            aria-label={t("shell.mobileNavigation")}
            className="flex-1 overflow-y-auto px-2 py-3"
          >
            {sections.map((section) => (
              <section key={section.id} className="mb-4">
                <h2 className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.06em] text-primary">
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
                          className={`flex min-h-[var(--size-tap-target-min)] items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            active
                              ? "bg-chrome-active text-text-on-primary"
                              : "text-chrome-fg-muted hover:bg-chrome-border hover:text-chrome-fg"
                          }`}
                          onClick={() =>
                            closeSheet({ restoreFocus: false })
                          }
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
          <div
            aria-label={t("shell.userMenu")}
            className="space-y-2 border-t border-chrome-border p-3"
          >
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <div className="flex items-center gap-2">
              <LocaleSelector updateLocaleAction={updateLocaleAction} />
              <button
                type="button"
                data-testid="btn_logout_mobile"
                className="min-h-[var(--size-tap-target-min)] flex-1 rounded-md border border-chrome-border px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={logout}
              >
                {t("auth.signOut")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
