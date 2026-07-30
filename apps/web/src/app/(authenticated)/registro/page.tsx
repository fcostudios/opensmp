import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { hasCapability } from "@smp/domain/identity-access";
import {
  parseRegisterFilters,
  serializeRegisterFilters,
} from "@smp/contracts/register";

import { RegisterFilters } from "@/components/register/register-filters";
import { RegisterTable } from "@/components/register/register-table";
import { RegisterExportButton } from "@/components/register/register-export-button";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { registerRepository } from "@/modules/register/repository";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export default async function ScrRegisterPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || !hasCapability(authorization, "finance:read") || (authorization.globalRole !== "group_admin" && authorization.globalRole !== "central_finance")) {
    redirect("/acceso-denegado");
  }
  let filters;
  try {
    filters = parseRegisterFilters(await searchParams);
  } catch {
    redirect("/registro");
  }
  const [page, facets, locale, t] = await Promise.all([
    registerRepository.listRows(authorization, filters),
    registerRepository.facets(authorization),
    getLocale(),
    getTranslations("register"),
  ]);
  const labels = {
    all: t("all"), apply: t("apply"), closed: t("closed"), company: t("company"), companyCode: t("companyCode"),
    dateFrom: t("dateFrom"), dateTo: t("dateTo"), drilldownClose: t("drilldownClose"), drilldownDecisionDate: t("drilldownDecisionDate"), drilldownSource: t("drilldownSource"),
    drilldownStatementLines: t("drilldownStatementLines"), drilldownTitle: t("drilldownTitle"), empty: t("empty"), endReason: t("endReason"),
    endReasonInactive: t("endReasonInactive"), endReasonLeftCompany: t("endReasonLeftCompany"), endReasonReallocated: t("endReasonReallocated"),
    endedOn: t("endedOn"), licenseType: t("licenseType"), note: t("note"), open: t("open"), openState: t("openState"), organization: t("organization"),
    person: t("person"), requestApproved: t("requestApproved"), requestPending: t("requestPending"), requestRejected: t("requestRejected"), source: t("source"), sourceImport: t("sourceImport"), sourceReconciliation: t("sourceReconciliation"),
    sourceRequest: t("sourceRequest"), sourceKind: t("sourceKind"), sourceRequestNo: t("sourceRequestNo"), startedOn: t("startedOn"), tableCaption: t("tableCaption"), viewStatement: t("viewStatement"),
  };
  const nextParameters = new URLSearchParams(serializeRegisterFilters(filters));
  if (page.nextCursor) nextParameters.set("cursor", page.nextCursor);

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">{t("title")}</p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">{t("title")}</h1>
        <p className="mt-1 text-text-secondary">{t("subtitle")}</p>
      </header>
      <section data-testid="register_filters">
        <h2 className="mb-3 font-semibold text-text-primary">{t("filters")}</h2>
        <RegisterFilters companies={facets.companies} endReasons={facets.endReasons} filters={filters} labels={labels} licenseTypes={facets.licenseTypes} people={facets.people} sourceRequestNos={facets.sourceRequestNos} vendorAccounts={facets.vendorAccounts} />
      </section>
      <div className="flex justify-end" data-testid="register_actions">
        <RegisterExportButton errorLabel={t("exportError")} filters={filters} label={t("export")} />
      </div>
      <section data-testid="register_table">
        <h2 className="font-semibold text-text-primary">{t("tableCaption")}</h2>
        <p className="mt-1 text-sm text-text-secondary">{t("tableDescription")}</p>
        <div className="mt-4"><RegisterTable canViewRequests={authorization.globalRole === "group_admin"} canViewStatements items={page.items} labels={labels} locale={locale} /></div>
        {page.nextCursor ? <a className="mt-4 inline-flex min-h-11 items-center rounded border border-border px-4" href={`?${nextParameters.toString()}`}>{labels.apply}</a> : null}
      </section>
      <section className="rounded border border-border bg-info-bg p-4 text-info-text" data-testid="integrity_note">
        <h2 className="font-semibold">{t("integrityTitle")}</h2>
        <p className="mt-1">{t("integrityContent")}</p>
      </section>
    </main>
  );
}
