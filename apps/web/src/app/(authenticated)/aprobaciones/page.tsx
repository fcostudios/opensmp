import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { hasCapability } from "@smp/domain/identity-access";

import {
  ApprovalQueue,
  type ApprovalQueueLabels,
} from "@/components/requests/approval-queue";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { decideRequest } from "@/modules/request-workflow/actions/decide-request";
import { approvalRepository } from "@/modules/request-workflow/approval-repository";
import { approvalEcuadorCalendar } from "@/modules/request-workflow/approval/ecuador-calendar";
import { resolveApprovalPageTarget } from "./approval-target";

export default async function ScrApprovalQueuePage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly requestId?: string | readonly string[];
  }>;
}) {
  const authorization = await loadCurrentLedgerAuthorization();
  if (
    !authorization ||
    !hasCapability(authorization, "request:approve")
  ) {
    redirect("/acceso-denegado");
  }
  const [items, locale, t] = await Promise.all([
    approvalRepository.listPending(
      authorization,
      new Date(),
      approvalEcuadorCalendar,
    ),
    getLocale(),
    getTranslations("approvalQueue"),
  ]);
  const targetRequestId = await resolveApprovalPageTarget(searchParams, items);
  const labels: ApprovalQueueLabels = {
    agingHours: t("agingHours"),
    approve: t("approve"),
    approveCost: t("approveCost"),
    approveDescription: t("approveDescription"),
    approveProjected: t("approveProjected"),
    approveTitle: t("approveTitle"),
    availableOf: t("availableOf"),
    budgetHeadroom: t("budgetHeadroom"),
    cancel: t("cancel"),
    company: t("company"),
    committedCost: t("committedCost"),
    createdAt: t("createdAt"),
    decisionError: t("decisionError"),
    emptyDescription: t("emptyDescription"),
    emptyTitle: t("emptyTitle"),
    headroomUnavailable: t("headroomUnavailable"),
    justification: t("justification"),
    license: t("license"),
    missingRate: t("missingRate"),
    monthlyCost: t("monthlyCost"),
    neededBy: t("neededBy"),
    organization: t("organization"),
    pendingApproval: t("pendingApproval"),
    reject: t("reject"),
    rejectionComment: t("rejectionComment"),
    rejectionDescription: t("rejectionDescription"),
    rejectionPlaceholder: t("rejectionPlaceholder"),
    rejectionRequired: t("rejectionRequired"),
    rejectionTitle: t("rejectionTitle"),
    state: t("state"),
    submitting: t("submitting"),
    successApproved: t("successApproved"),
    successRejected: t("successRejected"),
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
          {t("title")}
        </p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {t("title")}
        </h1>
        <p className="mt-1 text-text-secondary">{t("subtitle")}</p>
      </header>
      <ApprovalQueue
        action={decideRequest}
        items={items}
        labels={labels}
        locale={locale as "es-EC" | "en-US"}
        targetRequestId={targetRequestId}
      />
    </main>
  );
}
