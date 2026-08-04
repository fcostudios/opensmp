import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PoolCards, type PoolCardsLabels } from "@/components/pools/pool-cards";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { getPoolRepository } from "@/modules/vendor-catalog/production-pool-repository";
import { poolOperatingDate } from "@/modules/vendor-catalog/pool-repository";

// Stryker disable all: This Server Component is a thin composition root. Its
// authorization/query behavior is owned by repository integration tests and
// its rendered capacity behavior by PoolCards mutation tests.
export default async function ScrPoolsPage() {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || authorization.globalRole !== "group_admin") {
    redirect("/acceso-denegado");
  }

  const at = new Date();
  const [items, locale, t] = await Promise.all([
    getPoolRepository().listSnapshots(authorization, at),
    getLocale(),
    getTranslations("pools"),
  ]);
  const labels: PoolCardsLabels = {
    addCapacity: t("addCapacity"),
    assigned: t("assigned"),
    attention: t("attention"),
    automated: t("automated"),
    candidateTitle: t("candidateTitle"),
    available: t("available"),
    discrepancy: t("discrepancy"),
    emptyDescription: t("emptyDescription"),
    emptyTitle: t("emptyTitle"),
    effectiveFrom: t("effectiveFrom"),
    effectiveFromField: t("effectiveFromField"),
    escalated: t("escalated"),
    floor: t("floor"),
    lastActive: t("lastActive"),
    monthlyCost: t("monthlyCost"),
    mode: t("mode"),
    noUsageData: t("noUsageData"),
    note: t("note"),
    orchestration: t("orchestration"),
    pending: t("pending"),
    prorationNote: t("prorationNote"),
    purchased: t("purchased"),
    purchasedQty: t("purchasedQty"),
    renewal: t("renewal"),
    saveCapacity: t("saveCapacity"),
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
          {t("eyebrow")}
        </p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {t("title")}
        </h1>
        <p className="mt-1 max-w-3xl text-text-secondary">{t("subtitle")}</p>
        <p className="mt-2 text-sm text-text-muted">
          {t("freshness", { date: poolOperatingDate(at) })}
        </p>
      </header>
      <PoolCards
        items={items}
        labels={labels}
        locale={locale as "es-EC" | "en-US"}
      />
    </main>
  );
}
// Stryker restore all
