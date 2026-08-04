import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { BlockedRequestsTable } from "@/components/exceptions/blocked-requests-table";
import { ChecklistExceptionsList } from "@/components/requests/checklist-exceptions-list";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { createOrchestrationService } from "@/modules/request-workflow/orchestration";
import { requestReadRepository } from "@/modules/request-workflow/repository";
import { formatOperationalBadgeCount } from "@/modules/operational-alert-read";

const tabs = ["blocked", "failed", "drift", "expiredInvites"] as const;
type ExceptionTab = (typeof tabs)[number];

// Stryker disable all: This Server Component only composes already-tested
// authorization, request projections, and exception table components.
function activeTab(value: string | undefined): ExceptionTab {
  return tabs.find((tab) => tab === value) ?? "blocked";
}

export default async function ScrExceptionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly cursor?: string;
    readonly tab?: string;
  }>;
}) {
  const [authorization, locale, pages, orchestration, t, query] =
    await Promise.all([
      loadCurrentLedgerAuthorization(),
      getLocale(),
      getTranslations("pages"),
      getTranslations("orchestration"),
      getTranslations("exceptions"),
      searchParams,
    ]);
  if (!authorization || authorization.globalRole !== "group_admin") {
    redirect("/acceso-denegado");
  }
  const selected = activeTab(query.tab);
  const exceptionCounts =
    await requestReadRepository.countOperationalExceptions(authorization);
  const blocked =
    selected === "blocked"
      ? await requestReadRepository.listBlockedExceptions(authorization, {
          cursor: query.cursor,
        })
      : { items: [], nextCursor: null };
  let failures: Awaited<
    ReturnType<
      ReturnType<typeof createOrchestrationService>["verificationFailures"]
    >
  > = { items: [], nextCursor: null };
  if (selected === "failed") {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const service = createOrchestrationService(process.env.DATABASE_URL);
    try {
      failures = await service.verificationFailures(authorization, {
        cursor: query.cursor,
      });
    } finally {
      await service.close();
    }
  }
  const counts: Record<ExceptionTab, string> = {
    blocked: formatOperationalBadgeCount(
      exceptionCounts.blocked,
      t("countOverflow"),
    ),
    drift: "0",
    expiredInvites: "0",
    failed: formatOperationalBadgeCount(
      exceptionCounts.failed,
      t("countOverflow"),
    ),
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
          {t("eyebrow")}
        </p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {pages("excepciones.title")}
        </h1>
        <p className="mt-1 max-w-3xl text-text-secondary">{t("subtitle")}</p>
      </header>

      <section aria-labelledby="exceptions-title" data-testid="exceptions_tabs">
        <h2
          className="font-display text-xl font-semibold text-text-primary"
          id="exceptions-title"
        >
          {t("title")}
        </h2>
        <nav aria-label={t("tabsLabel")} className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <Link
              aria-current={selected === tab ? "page" : undefined}
              className="whitespace-nowrap rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              data-testid={
                tab === "expiredInvites"
                  ? "tab_expired_invites"
                  : `tab_${tab}`
              }
              href={`?tab=${tab}`}
              key={tab}
            >
              {t(`tabs.${tab}`)}{" "}
              <span className="font-mono text-xs text-text-muted">
                {counts[tab]}
              </span>
            </Link>
          ))}
        </nav>

        {selected === "blocked" ? (
          <BlockedRequestsTable
            items={blocked.items.map((request) => ({
              companyName: request.companyName,
              daysBlocked: request.daysBlocked,
              decisionEvidence: request.decisionEvidence,
              escalated: request.escalated,
              id: request.id,
              licenseTypeId: request.licenseTypeId,
              licenseTypeName: request.licenseTypeName,
              neededBy: request.neededBy,
              personName: request.personName,
              requestNo: request.requestNo,
              vendorAccountName: request.vendorAccountName,
              vendorAccountId: request.vendorAccountId,
            }))}
            labels={{
              addCapacity: t("blocked.addCapacity"),
              company: t("blocked.company"),
              daysBlocked: t("blocked.daysBlocked"),
              empty: t("blocked.empty"),
              effectiveFrom: t("blocked.effectiveFrom"),
              escalated: t("blocked.escalated"),
              lastActive: t("blocked.lastActive"),
              monthlyCost: t("blocked.monthlyCost"),
              neededBy: t("blocked.neededBy"),
              noDate: t("blocked.noDate"),
              noUsageData: t("blocked.noUsageData"),
              organization: t("blocked.organization"),
              purchasedQty: t("blocked.purchasedQty"),
              prorationNote: t("blocked.prorationNote"),
              reclaimCandidates: t("blocked.reclaimCandidates"),
              request: t("blocked.request"),
              status: t("blocked.status"),
              statusBlocked: t("blocked.statusBlocked"),
              saveCapacity: t("blocked.saveCapacity"),
              viewPools: t("blocked.viewPools"),
            }}
            locale={locale as "en-US" | "es-EC"}
          />
        ) : null}

        {selected === "failed" ? (
          <ChecklistExceptionsList
            failures={failures.items}
            labels={{
              action: orchestration("exceptionAction"),
              empty: orchestration("exceptionsEmpty"),
              failureAssignmentMissing: orchestration(
                "exceptionAssignmentMissing",
              ),
              kindChecklist: orchestration("exceptionChecklist"),
              mode: orchestration("exceptionMode"),
              modeOrchestration: orchestration("exceptionOrchestration"),
              noData: orchestration("exceptionNoData"),
              organization: orchestration("exceptionOrganization"),
              reason: orchestration("exceptionReason"),
              retryProvisioning: orchestration("retryProvisioning"),
              retryUnavailable: orchestration("retryUnavailable"),
              request: orchestration("exceptionRequest"),
              sentAt: orchestration("exceptionSentAt"),
              status: orchestration("exceptionStatus"),
              statusFailed: orchestration("exceptionFailed"),
              statusVerificationFailed: orchestration(
                "exceptionVerificationFailed",
              ),
              viewRequest: orchestration("viewRequest"),
              vendorReference: orchestration("exceptionVendorReference"),
            }}
            locale={locale as "en-US" | "es-EC"}
          />
        ) : null}

        {selected === "drift" ? (
          <p
            className="mt-5 rounded border border-dashed border-border p-8 text-center text-text-secondary"
            data-testid="table_drift"
          >
            {t("future.drift")}
          </p>
        ) : null}
        {selected === "expiredInvites" ? (
          <p
            className="mt-5 rounded border border-dashed border-border p-8 text-center text-text-secondary"
            data-testid="table_expired_invites"
          >
            {t("future.expiredInvites")}
          </p>
        ) : null}
        {(selected === "blocked" ? blocked.nextCursor : failures.nextCursor) ? (
          <Link
            className="mt-4 inline-flex rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="exceptions_load_more"
            href={`?tab=${selected}&cursor=${encodeURIComponent(
              (selected === "blocked"
                ? blocked.nextCursor
                : failures.nextCursor)!,
            )}`}
          >
            {t("loadMore")}
          </Link>
        ) : null}
      </section>
    </main>
  );
}
// Stryker restore all
