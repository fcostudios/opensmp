import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PoolTiles } from "@/components/pools/pool-tiles";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { getPoolRepository } from "@/modules/vendor-catalog/production-pool-repository";
import {
  parseVendorAccountId,
  poolOperatingDate,
} from "@/modules/vendor-catalog/pool-repository";

export default async function ScrVendorAccountDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly vendorAccountId: string }>;
}) {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || authorization.globalRole !== "group_admin") {
    redirect("/acceso-denegado");
  }
  const vendorAccountId = parseVendorAccountId(
    (await params).vendorAccountId,
  );
  if (!vendorAccountId) notFound();
  const at = new Date();
  const [snapshots, t] = await Promise.all([
    getPoolRepository().listSnapshots(authorization, at, vendorAccountId),
    getTranslations("pools"),
  ]);
  if (snapshots.length === 0) notFound();
  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
          {t("detailEyebrow")}
        </p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {snapshots[0].vendorAccountName}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("freshness", { date: poolOperatingDate(at) })}
        </p>
      </header>
      {/* US-022 is read-only pool truth; purchase and reclaim belong to US-023. */}
      <PoolTiles
        idPrefix="tile"
        labels={{
          assigned: t("assigned"),
          free: t("available"),
          pending: t("pending"),
          purchased: t("purchased"),
        }}
        snapshots={snapshots}
      />
    </main>
  );
}
