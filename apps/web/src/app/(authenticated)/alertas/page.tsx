import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import type { AlertType } from "@smp/contracts/alerts";

import {
  AlertList,
  alertScopeText,
  type AlertPresentationSource,
} from "@/components/alerts/alert-list";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import {
  createAlertRepository,
  type CompanyAlertEvent,
} from "@/modules/alerts/repository";
import { formatOperationalBadgeCount } from "@/modules/operational-alert-read";

function subjectText(subject: unknown, fallback: string): string {
  if (!subject || typeof subject !== "object") return fallback;
  const values = Object.values(subject).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return values.length > 0 ? values.join(" · ") : fallback;
}

function notificationKey(value: unknown): "pending" | "sent" {
  return value &&
    typeof value === "object" &&
    "status" in value &&
    value.status === "sent"
    ? "sent"
    : "pending";
}

export default async function ScrAlertsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly cursor?: string;
    readonly filter?: string;
  }>;
}) {
  const [authorization, locale, t, query] = await Promise.all([
    loadCurrentLedgerAuthorization(),
    getLocale(),
    getTranslations("alerts"),
    searchParams,
  ]);
  if (!authorization || authorization.globalRole !== "group_admin") {
    redirect("/acceso-denegado");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const activeFilter = query.filter === "all" ? "all" : "unacknowledged";
  const repository = createAlertRepository(process.env.DATABASE_URL);
  let eventPage: {
    readonly items: readonly CompanyAlertEvent[];
    readonly nextCursor: string | null;
  };
  let eventCounts: {
    readonly all: bigint;
    readonly unacknowledged: bigint;
  };
  try {
    [eventPage, eventCounts] = await Promise.all([
      repository.listAuthorizedEvents(authorization, {
        cursor: query.cursor,
        filter: activeFilter,
      }),
      repository.countAuthorizedEvents(authorization),
    ]);
  } finally {
    await repository.close();
  }

  const items: AlertPresentationSource[] = eventPage.items.map((event) => ({
    acknowledgedAt: event.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: event.acknowledgedBy,
    firedAt: event.firedAt.toISOString(),
    id: event.id,
    notified: t(`notification.${notificationKey(event.notified)}`),
    rawSubject: event.subjectLinkAllowed ? event.subjectRef : null,
    rawType: event.alertType,
    scope: alertScopeText(event.scopeKind, event.companyName, {
      company: (companyName) => t("scope.company", { companyName }),
      global: t("scope.global"),
    }),
    subject: subjectText(event.subjectRef, t("subjectUnavailable")),
    type: t(`types.${event.alertType as AlertType}`),
  }));
  const allCount = formatOperationalBadgeCount(
    eventCounts.all,
    t("countOverflow"),
  );
  const unacknowledgedCount = formatOperationalBadgeCount(
    eventCounts.unacknowledged,
    t("countOverflow"),
  );

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
            {t("eyebrow")}
          </p>
          <h1 className="font-display text-3xl font-semibold text-text-primary">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-3xl text-text-secondary">{t("subtitle")}</p>
        </div>
        <Link
          className="rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="btn_configurar_reglas"
          href="/configuracion"
        >
          {t("configure")}
        </Link>
      </header>
      <section aria-labelledby="alerts-register-title">
        <h2
          className="font-display text-xl font-semibold text-text-primary"
          id="alerts-register-title"
        >
          {t("registerTitle")}
        </h2>
        <p className="mt-1 text-text-secondary">{t("registerDescription")}</p>
        <AlertList
          activeFilter={activeFilter}
          allCount={allCount}
          allHref="?filter=all"
          items={items}
          labels={{
            acknowledgedAt: t("columns.acknowledgedAt"),
            acknowledgedBy: t("columns.acknowledgedBy"),
            all: t("filters.all"),
            emptyAll: t("empty.all"),
            emptyUnacknowledged: t("empty.unacknowledged"),
            firedAt: t("columns.firedAt"),
            notified: t("columns.notified"),
            scope: t("columns.scope"),
            subject: t("columns.subject"),
            type: t("columns.type"),
            unacknowledged: t("filters.unacknowledged"),
          }}
          locale={locale as "en-US" | "es-EC"}
          unacknowledgedCount={unacknowledgedCount}
          unacknowledgedHref="?filter=unacknowledged"
        />
        {eventPage.nextCursor ? (
          <Link
            className="mt-4 inline-flex rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="alerts_load_more"
            href={`?filter=${activeFilter}&cursor=${encodeURIComponent(eventPage.nextCursor)}`}
          >
            {t("loadMore")}
          </Link>
        ) : null}
      </section>
      <aside
        className="rounded border border-border bg-surface p-4 text-sm text-text-secondary"
        data-testid="ack_note"
      >
        {t("acknowledgementNote")}
      </aside>
    </main>
  );
}
