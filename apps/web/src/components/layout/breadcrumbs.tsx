"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  BREADCRUMB_PATTERNS,
  ROUTE_SCREEN_IDS,
} from "@/lib/auth/screen-access.gen";
import { matchRoutePolicy } from "@/lib/auth/route-access";

export type ShellBreadcrumb =
  | {
      readonly titleKey: string;
      readonly label?: never;
      readonly href: string | null;
    }
  | {
      readonly label: string;
      readonly titleKey?: never;
      readonly href: string | null;
    };

export type DynamicBreadcrumbLabels = Readonly<Record<string, string>>;

export interface ShellRouteContext {
  readonly titleKey: string;
  readonly breadcrumbs: readonly ShellBreadcrumb[];
}

function resolveDynamicLabel(
  template: string,
  labels: DynamicBreadcrumbLabels,
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
    const value = labels[token]?.trim();
    if (!value) {
      throw new Error(`Missing dynamic breadcrumb label: ${token}`);
    }
    return value;
  });
}

function titleKey(route: string): string {
  const pageKey = route
    .slice(1)
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? `[${segment.slice(1)}]` : segment,
    )
    .join("/");
  return `pages.${pageKey}.title`;
}

export function shellRouteContext(
  pathname: string,
  dynamicLabels: DynamicBreadcrumbLabels = {},
): ShellRouteContext | null {
  const match = matchRoutePolicy(pathname);
  if (!match) return null;

  const currentTitleKey = titleKey(match.policy.route);
  const patterns = (
    BREADCRUMB_PATTERNS as Readonly<
      Record<string, readonly string[] | undefined>
    >
  )[match.policy.route];
  if (!patterns) {
    return {
      titleKey: currentTitleKey,
      breadcrumbs: [{ titleKey: currentTitleKey, href: null }],
    };
  }

  const parentRoute = match.policy.route.split("/").slice(0, -1).join("/");
  if (!(parentRoute in ROUTE_SCREEN_IDS)) {
    return {
      titleKey: currentTitleKey,
      breadcrumbs: [{ titleKey: currentTitleKey, href: null }],
    };
  }
  return {
    titleKey: currentTitleKey,
    breadcrumbs: [
      { titleKey: titleKey(parentRoute), href: parentRoute },
      {
        label: resolveDynamicLabel(patterns.at(-1)!, dynamicLabels),
        href: null,
      },
    ],
  };
}

export function Breadcrumbs({
  items,
}: {
  readonly items: readonly ShellBreadcrumb[];
}) {
  const t = useTranslations();
  return (
    <nav aria-label={t("shell.breadcrumbs")} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-text-muted">
        {items.map((item, index) => (
          <li
            key={"label" in item ? item.label : item.titleKey}
            className="flex min-w-0 items-center gap-1"
          >
            {index > 0 ? <span aria-hidden>·</span> : null}
            {item.href ? (
              <Link
                href={item.href}
                className="min-h-[var(--size-tap-target-min)] content-center rounded-sm font-semibold text-primary outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                {"label" in item ? item.label : t(item.titleKey)}
              </Link>
            ) : (
              <span aria-current="page" className="truncate">
                {"label" in item ? item.label : t(item.titleKey)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
