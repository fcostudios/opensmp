import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { CapabilityCard, type CapabilityCardLabels } from "@/components/vendor-accounts/capability-card";
import type { VendorAccountFormLabels } from "@/components/vendor-accounts/vendor-account-form";
import { VendorAccountTabs, type VendorAccountTabsLabels } from "@/components/vendor-accounts/vendor-account-tabs";
import { PoolTiles } from "@/components/pools/pool-tiles";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { updateVendorAccount } from "@/modules/vendor-catalog/actions/manage-vendor-accounts";
import { getPoolRepository } from "@/modules/vendor-catalog/production-pool-repository";
import { getVendorAccountRepository } from "@/modules/vendor-catalog/production-vendor-account-repository";
import { parseVendorAccountId, poolOperatingDate } from "@/modules/vendor-catalog/pool-repository";

export default async function ScrVendorAccountDetailPage({ params }: {
  readonly params: Promise<{ readonly vendorAccountId: string }>;
}) {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || authorization.globalRole !== "group_admin") redirect(ROUTE_SCR_ACCESS_DENIED);

  const vendorAccountId = parseVendorAccountId((await params).vendorAccountId);
  if (!vendorAccountId) notFound();

  const at = new Date();
  const [detail, snapshots, t, poolsT, locale] = await Promise.all([
    getVendorAccountRepository().detail(authorization, vendorAccountId, at),
    getPoolRepository().listSnapshots(authorization, at, vendorAccountId),
    getTranslations("vendorAccounts"),
    getTranslations("pools"),
    getLocale(),
  ]);
  if (!detail) notFound();

  const capabilityLabels: CapabilityCardLabels = {
    canDeprovision: t("detail.capabilities.canDeprovision"),
    canProvision: t("detail.capabilities.canProvision"),
    fallback: t("detail.capabilities.fallback"),
    hasCostData: t("detail.capabilities.hasCostData"),
    hasUsageData: t("detail.capabilities.hasUsageData"),
    identityMatching: t("detail.capabilities.identityMatching"),
    identityValues: { email: t("detail.capabilities.identity.email"), upn: t("detail.capabilities.identity.upn"), vendor_user_id: t("detail.capabilities.identity.vendor_user_id") },
    notSupported: t("detail.capabilities.notSupported"),
    protocol: t("detail.capabilities.protocol"),
    protocolValues: { none: t("protocol.none"), rest: t("protocol.rest"), scim: t("protocol.scim") },
    supported: t("detail.capabilities.supported"),
    title: t("detail.capabilities.title"),
  };
  const formLabels: VendorAccountFormLabels = {
    cancel: t("form.cancel"), description: t("form.description"),
    errors: { contractRenewalOn: t("form.errors.contractRenewalOn"), duplicate: t("form.errors.duplicate"), generic: t("detail.settings.genericError"), lowPoolFloor: t("form.errors.lowPoolFloor"), mode: t("form.errors.mode"), name: t("form.errors.name"), status: t("form.errors.mode"), vendorId: t("form.errors.vendorId"), vendorOrgRef: t("form.errors.vendorOrgRef") },
    fields: { contractRenewalOn: t("form.fields.contractRenewalOn"), lowPoolFloor: t("form.fields.lowPoolFloor"), mode: t("form.fields.mode"), name: t("form.fields.name"), status: t("detail.settings.status"), vendorId: t("form.fields.vendorId"), vendorOrgRef: t("form.fields.vendorOrgRef") },
    help: { lowPoolFloor: t("form.help.lowPoolFloor"), vendor: t("form.help.vendor"), vendorOrgRef: t("form.help.vendorOrgRef") },
    modes: { automated: t("form.modes.automated"), orchestration: t("form.modes.orchestration") },
    statuses: { active: t("status.active"), inactive: t("status.inactive") },
    submit: t("detail.settings.submit"), submitting: t("detail.settings.submitting"), success: t("detail.settings.saved"), title: t("detail.settings.title"), trigger: t("detail.tabs.settings"),
  };
  const tabLabels: VendorAccountTabsLabels = {
    capacity: { empty: poolsT("emptyDescription"), label: t("detail.tabs.capacity") },
    licenses: { active: t("status.active"), caption: t("detail.licenses.caption"), effectiveFrom: t("detail.licenses.effectiveFrom"), effectiveTo: t("detail.licenses.effectiveTo"), inactive: t("status.inactive"), label: t("detail.tabs.licenseTypes"), monthlyRate: t("detail.licenses.monthlyRate"), name: t("detail.licenses.name"), noRate: t("detail.licenses.noRate"), openEnded: t("detail.licenses.openEnded"), status: t("detail.licenses.status"), unit: t("detail.licenses.unit"), units: { license: t("detail.licenses.license"), seat: t("detail.licenses.seat") } },
    settings: { label: t("detail.tabs.settings"), saved: t("detail.settings.saved") },
    tabsLabel: t("detail.tabsLabel"),
  };
  const renewal = detail.contractRenewalOn
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${detail.contractRenewalOn}T00:00:00.000Z`))
    : t("detail.noRenewal");

  return <main className="space-y-6 p-4 sm:p-6">
    <header className="border-b border-border pb-4">
      <p className="font-mono text-xs uppercase tracking-wide text-text-muted">{poolsT("detailEyebrow")}</p>
      <h1 className="font-display text-3xl font-semibold text-text-primary">{detail.name}</h1>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-text-muted">{t("detail.account")}</dt><dd className="font-medium text-text-primary">{detail.name}</dd></div>
        <div><dt className="text-text-muted">{t("detail.vendor")}</dt><dd className="font-medium text-text-primary">{detail.vendorName}</dd></div>
        <div><dt className="text-text-muted">{t("detail.mode")}</dt><dd className="font-medium text-text-primary">{t(`modes.${detail.mode}`)}</dd></div>
        <div><dt className="text-text-muted">{t("detail.renewal")}</dt><dd className="font-medium text-text-primary">{renewal}</dd></div>
      </dl>
      <p className="mt-3 text-sm text-text-muted">{poolsT("freshness", { date: poolOperatingDate(at) })}</p>
    </header>

    <CapabilityCard capabilities={detail.capabilities} labels={capabilityLabels} />
    <VendorAccountTabs
      account={detail}
      action={updateVendorAccount.bind(null, detail.id)}
      capacity={snapshots.length > 0 ? <PoolTiles idPrefix="tile" labels={{ assigned: poolsT("assigned"), free: poolsT("available"), pending: poolsT("pending"), purchased: poolsT("purchased") }} snapshots={snapshots} /> : <div className="rounded border border-dashed border-border p-6 text-center text-text-secondary"><h2 className="font-display text-lg font-semibold text-text-primary">{poolsT("emptyTitle")}</h2><p className="mt-1 text-sm">{poolsT("emptyDescription")}</p></div>}
      formLabels={formLabels}
      labels={tabLabels}
      licenseTypes={detail.licenseTypes}
      locale={locale}
    />
  </main>;
}
