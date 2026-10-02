import { withdrawInvite } from "@/modules/request-workflow/actions/withdraw-invite";
import Link from "next/link";
import { OverdueInvitesTable } from "@/components/exceptions/overdue-invites-table";
import { BlockedRequestsTable } from "@/components/exceptions/blocked-requests-table";
import { ChecklistExceptionsList } from "@/components/requests/checklist-exceptions-list";
import type { createOrchestrationService } from "@/modules/request-workflow/orchestration";
import type { requestReadRepository } from "@/modules/request-workflow/repository";
import { retryProvisioning } from "@/modules/request-workflow/actions/retry-provisioning";
import { createBlockedRequestsLabels, toBlockedRequestItem } from "./labels";
import { failedInviteLabels, retryErrorMessageKey } from "./retry-labels";

type ExceptionTab = "blocked" | "failed" | "drift" | "expiredInvites";
const tabs = ["blocked", "failed", "drift", "expiredInvites"] as const;

export function ExceptionsView({
  selected,
  blocked,
  invitations,
  failures,
  retryErrorKey,
  counts,
  locale,
  title,
  orchestration,
  t,
}: {
  readonly selected: ExceptionTab;
  readonly blocked: Pick<Awaited<ReturnType<typeof requestReadRepository.listBlockedExceptions>>, "items" | "nextCursor">;
  readonly invitations: Pick<Awaited<ReturnType<typeof requestReadRepository.listOverdueInvitations>>, "items" | "nextCursor">;
  readonly failures: Awaited<ReturnType<ReturnType<typeof createOrchestrationService>["verificationFailures"]>>;
  readonly retryErrorKey: ReturnType<typeof retryErrorMessageKey>;
  readonly counts: Record<ExceptionTab, string>;
  readonly locale: string;
  readonly title: string;
  readonly orchestration: (key: string) => string;
  readonly t: (key: string) => string;
}) {
  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
          {t("eyebrow")}
        </p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {title}
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
        {retryErrorKey ? (
          <p className="mt-3 rounded border border-error-dot bg-error-bg p-3 text-error-text" role="alert">
            {orchestration(retryErrorKey)}
          </p>
        ) : null}
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
            items={blocked.items.map(toBlockedRequestItem)}
            labels={createBlockedRequestsLabels(t)}
            locale={locale as "en-US" | "es-EC"}
          />
        ) : null}

        {selected === "failed" ? (
          <ChecklistExceptionsList
            failures={failures.items}
            labels={{
              ...failedInviteLabels(orchestration),
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
              vendorReference: orchestration("exceptionVendorReference"),
            }}
            locale={locale as "en-US" | "es-EC"}
            retryAction={retryProvisioning}
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
          <OverdueInvitesTable items={invitations.items} locale={locale as "en-US"|"es-EC"}
            withdrawAction={withdrawInvite}
            labels={{request:t("overdueInvites.request"),ageHours:t("overdueInvites.ageHours"),empty:t("overdueInvites.empty"),
              withdraw:t("overdueInvites.withdraw"),pending:t("overdueInvites.pending"),note:t("overdueInvites.note"),success:t("overdueInvites.success"),
              errors:{invalid:t("overdueInvites.errors.invalid"),forbidden:t("overdueInvites.errors.forbidden"),conflict:t("overdueInvites.errors.conflict"),unsupported:t("overdueInvites.errors.unsupported"),provider_error:t("overdueInvites.errors.provider_error"),ambiguous:t("overdueInvites.errors.ambiguous")}}} />
        ) : null}
        {(selected === "blocked" ? blocked.nextCursor : selected === "expiredInvites" ? invitations.nextCursor : failures.nextCursor) ? (
          <Link
            className="mt-4 inline-flex rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="exceptions_load_more"
            href={`?tab=${selected}&cursor=${encodeURIComponent(
              (selected === "blocked"
                ? blocked.nextCursor
                : selected === "expiredInvites" ? invitations.nextCursor : failures.nextCursor)!,
            )}`}
          >
            {t("loadMore")}
          </Link>
        ) : null}
      </section>
    </main>
  );
}
