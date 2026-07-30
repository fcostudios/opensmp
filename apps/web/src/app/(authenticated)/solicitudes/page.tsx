import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import {
  REQUEST_STATUSES,
  type RequestStatus,
} from "@smp/ui";

import {
  filterRequestList,
  RequestList,
  type RequestListFilters,
  type RequestListLabels,
} from "@/components/requests/request-list";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { requestReadRepository } from "@/modules/request-workflow/repository";

function safeDate(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export default async function ScrMyRequestsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly from?: string;
    readonly state?: string;
    readonly to?: string;
  }>;
}) {
  const [authorization, locale, t, status, query] = await Promise.all([
    loadCurrentLedgerAuthorization(),
    getLocale(),
    getTranslations("requestHistory"),
    getTranslations("status"),
    searchParams,
  ]);
  if (
    !authorization ||
    !(
      authorization.globalRole === "group_admin" ||
      authorization.employeeCompanyId !== null ||
      authorization.companyGrants.some(({ role }) => role === "approver")
    )
  ) {
    redirect("/acceso-denegado");
  }
  const filters: RequestListFilters = {
    from: safeDate(query.from),
    state:
      query.state &&
      REQUEST_STATUSES.includes(query.state as RequestStatus)
        ? query.state
        : "",
    to: safeDate(query.to),
  };
  const items = filterRequestList(
    await requestReadRepository.list(authorization),
    filters,
  );
  const labels: RequestListLabels = {
    allStates: t("allStates"),
    company: t("organization"),
    decided: t("decided"),
    emptyDescription: t("emptyDescription"),
    emptyTitle: t("emptyTitle"),
    filters: t("filters"),
    from: t("from"),
    licenseRequest: t("licenseRequest"),
    neededBy: t("neededBy"),
    newRequest: t("newRequest"),
    state: t("state"),
    submitted: t("sentAt"),
    tableTitle: t("tableTitle"),
    to: t("to"),
  };
  const statusLabels = Object.fromEntries(
    REQUEST_STATUSES.map((requestStatus) => [
      requestStatus,
      status(requestStatus),
    ]),
  ) as Record<RequestStatus, string>;

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
          {t("title")}
        </p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {t("title")}
        </h1>
        <p className="mt-1 text-text-secondary">{t("subtitle")}</p>
      </header>
      <RequestList
        filters={filters}
        items={items}
        labels={labels}
        locale={locale === "en-US" ? "en-US" : "es-EC"}
        statusLabels={statusLabels}
      />
    </main>
  );
}
