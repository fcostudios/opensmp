import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import type { AuthorizationContext } from "@smp/domain/identity-access";

import { AuditFilters } from "@/components/audit/audit-filters";
import { AuditTable } from "@/components/audit/audit-table";
import { auth } from "@/lib/auth/auth-config";
import {
  AuditViewerAccessError,
  auditQueryService,
} from "@/modules/audit/queries";
import { parseAuditFilters } from "@/modules/audit/types";

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function AuditPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const authorization: AuthorizationContext = {
    userAccountId: session.user.id,
    idpSubject: session.user.idpSubject,
    globalRole: session.user.globalRole,
    employeeCompanyId: session.user.employeeCompanyId,
    companyGrants: session.user.companyGrants,
  };
  const filters = parseAuditFilters(await searchParams);
  let page;
  let actors;
  let actions;
  let entityTypes;
  try {
    [page, actors, actions, entityTypes] = await Promise.all([
      auditQueryService.list(authorization, filters),
      auditQueryService.actors(authorization),
      auditQueryService.actions(authorization),
      auditQueryService.entityTypes(authorization),
    ]);
  } catch (error) {
    if (error instanceof AuditViewerAccessError) {
      redirect("/acceso-denegado");
    }
    throw error;
  }

  const locale = await getLocale();
  const t = await getTranslations("audit");
  const labels = {
    action: t("action"),
    actor: t("actor"),
    added: t("added"),
    all: t("all"),
    after: t("after"),
    applyFilters: t("applyFilters"),
    before: t("before"),
    close: t("close"),
    company: t("company"),
    dateFrom: t("dateFrom"),
    dateTo: t("dateTo"),
    details: t("details"),
    empty: t("empty"),
    entity: t("entity"),
    next: t("next"),
    note: t("note"),
    occurredAt: t("occurredAt"),
    removed: t("removed"),
    systemActor: t("systemActor"),
  };
  const filterQuery = Object.fromEntries(
    Object.entries(filters)
      .filter(([key]) => key !== "cursor")
      .map(([key, value]) => [key, value ?? ""]),
  );

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-text-primary">
          {t("title")}
        </h1>
        <p className="mt-2 text-text-secondary">{t("subtitle")}</p>
      </header>
      <section
        className="rounded border border-border bg-info-bg p-4 text-info-text"
        data-testid="banner_append_only"
      >
        <h2 className="font-semibold">{t("appendOnlyTitle")}</h2>
        <p className="mt-1">{t("appendOnlyContent")}</p>
      </section>
      <AuditFilters
        actions={actions}
        actors={actors}
        entityTypes={entityTypes}
        filters={filters}
        labels={labels}
      />
      <AuditTable
        filterQuery={filterQuery}
        items={page.items}
        labels={labels}
        locale={locale}
        nextCursor={page.nextCursor}
      />
    </div>
  );
}
