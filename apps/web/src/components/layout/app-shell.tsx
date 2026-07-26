"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { StoredLocale } from "@smp/contracts";
import { AppShell as ShellFrame } from "@smp/ui";

import type { LedgerRole } from "@/lib/auth/auth-types";
import { Header } from "./header";
import { MobileBar } from "./mobile-bar";
import { Sidebar } from "./sidebar";
import {
  shellRouteContext,
  type DynamicBreadcrumbLabels,
} from "./breadcrumbs";

export function ApplicationShell({
  children,
  dynamicBreadcrumbLabels = {},
  displayName,
  roles,
  updateLocaleAction,
}: {
  readonly children: ReactNode;
  readonly dynamicBreadcrumbLabels?: DynamicBreadcrumbLabels;
  readonly displayName: string;
  readonly roles: readonly LedgerRole[];
  readonly updateLocaleAction: (input: {
    locale: StoredLocale;
  }) => Promise<void>;
}) {
  const pathname = usePathname();
  const t = useTranslations();
  const routeContext = shellRouteContext(pathname, dynamicBreadcrumbLabels);
  if (!routeContext) return null;

  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 font-semibold text-text-on-primary outline-none focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:ring-2 focus:ring-chrome-bg"
      >
        {t("shell.skipToContent")}
      </a>
      <ShellFrame
        desktopNavigation={
          <Sidebar pathname={pathname} roles={roles} />
        }
        mobileNavigation={
          <MobileBar
            displayName={displayName}
            pathname={pathname}
            roles={roles}
            updateLocaleAction={updateLocaleAction}
          />
        }
        header={
          <Header
            breadcrumbs={routeContext.breadcrumbs}
            displayName={displayName}
            titleKey={routeContext.titleKey}
            updateLocaleAction={updateLocaleAction}
          />
        }
      >
        {children}
      </ShellFrame>
    </>
  );
}
