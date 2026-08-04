import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PoolCards } from "@/components/pools/pool-cards";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { getPoolRepository } from "@/modules/vendor-catalog/production-pool-repository";
import { poolOperatingDate } from "@/modules/vendor-catalog/pool-repository";

import { createPoolCardsLabels } from "./labels";

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
  const labels = createPoolCardsLabels(t);

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
