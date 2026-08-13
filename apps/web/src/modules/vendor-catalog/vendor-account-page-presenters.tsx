import { CapabilityCard, type CapabilityCardLabels } from "@/components/vendor-accounts/capability-card";
import { VendorAccountDialog } from "@/components/vendor-accounts/vendor-account-dialog";
import type { VendorAccountFormAction, VendorAccountFormLabels } from "@/components/vendor-accounts/vendor-account-form";
import { VendorAccountTabs, type VendorAccountTabsLabels } from "@/components/vendor-accounts/vendor-account-tabs";
import { VendorAccountsTable, type VendorAccountsTableLabels } from "@/components/vendor-accounts/vendor-accounts-table";
import { PoolTiles } from "@/components/pools/pool-tiles";
import { poolOperatingDate } from "./pool-repository";
import type { VendorAccountDetailPageData, VendorAccountsRegistryPageData } from "./vendor-account-page-loaders";

type Translate = (key: string, values?: Record<string, string>) => string;

export function registryFormLabels(t: Translate): VendorAccountFormLabels {
  return {
    cancel: t("form.cancel"), description: t("form.description"),
    errors: { contractRenewalOn: t("form.errors.contractRenewalOn"), duplicate: t("form.errors.duplicate"), generic: t("form.errors.generic"), lowPoolFloor: t("form.errors.lowPoolFloor"), mode: t("form.errors.mode"), name: t("form.errors.name"), vendorId: t("form.errors.vendorId"), vendorOrgRef: t("form.errors.vendorOrgRef") },
    fields: { contractRenewalOn: t("form.fields.contractRenewalOn"), lowPoolFloor: t("form.fields.lowPoolFloor"), mode: t("form.fields.mode"), name: t("form.fields.name"), vendorId: t("form.fields.vendorId"), vendorOrgRef: t("form.fields.vendorOrgRef") },
    help: { lowPoolFloor: t("form.help.lowPoolFloor"), vendor: t("form.help.vendor"), vendorOrgRef: t("form.help.vendorOrgRef") }, modes: { automated: t("form.modes.automated"), orchestration: t("form.modes.orchestration") },
    submit: t("form.submit"), submitting: t("form.submitting"), success: t("form.success"), title: t("form.title"), trigger: t("form.trigger"),
  };
}

export function detailFormLabels(t: Translate): VendorAccountFormLabels {
  const base = registryFormLabels(t);
  return {
    ...base,
    errors: { ...base.errors, generic: t("detail.settings.genericError"), status: t("form.errors.mode") },
    fields: { ...base.fields, status: t("detail.settings.status") },
    statuses: { active: t("status.active"), inactive: t("status.inactive") },
    submit: t("detail.settings.submit"), submitting: t("detail.settings.submitting"), success: t("detail.settings.saved"), title: t("detail.settings.title"), trigger: t("detail.tabs.settings"),
  };
}

export function registryTableLabels(t: Translate): VendorAccountsTableLabels {
  return {
    columns: { connector: t("columns.connector"), credential: t("columns.credential"), floor: t("columns.floor"), mode: t("columns.mode"), name: t("columns.name"), renewal: t("columns.renewal"), seats: t("columns.seats"), status: t("columns.status"), vendor: t("columns.vendor") },
    connector: { api: t("connector.api"), manual: t("connector.manual"), orchestration: t("connector.orchestration") }, credential: { auth_failed: t("credential.auth_failed"), none: t("credential.none"), ok: t("credential.ok"), unverified: t("credential.unverified") }, empty: t("empty"), modes: { automated: t("modes.automated"), orchestration: t("modes.orchestration") }, noRenewal: t("noRenewal"), protocol: { none: t("protocol.none"), rest: t("protocol.rest"), scim: t("protocol.scim") }, seatsPattern: t("seatsPattern", { free: "{free}", purchased: "{purchased}" }), status: { active: t("status.active"), inactive: t("status.inactive") }, tableCaption: t("tableCaption"), viewAccount: t("viewAccount"),
  };
}

export function capabilityLabels(t: Translate): CapabilityCardLabels {
  return { canDeprovision: t("detail.capabilities.canDeprovision"), canProvision: t("detail.capabilities.canProvision"), fallback: t("detail.capabilities.fallback"), hasCostData: t("detail.capabilities.hasCostData"), hasUsageData: t("detail.capabilities.hasUsageData"), identityMatching: t("detail.capabilities.identityMatching"), identityValues: { email: t("detail.capabilities.identity.email"), upn: t("detail.capabilities.identity.upn"), vendor_user_id: t("detail.capabilities.identity.vendor_user_id") }, notSupported: t("detail.capabilities.notSupported"), protocol: t("detail.capabilities.protocol"), protocolValues: { none: t("protocol.none"), rest: t("protocol.rest"), scim: t("protocol.scim") }, supported: t("detail.capabilities.supported"), title: t("detail.capabilities.title") };
}

export function detailTabLabels(t: Translate, poolsT: Translate): VendorAccountTabsLabels {
  return { capacity: { empty: poolsT("emptyDescription"), label: t("detail.tabs.capacity") }, licenses: { active: t("status.active"), caption: t("detail.licenses.caption"), effectiveFrom: t("detail.licenses.effectiveFrom"), effectiveTo: t("detail.licenses.effectiveTo"), inactive: t("status.inactive"), label: t("detail.tabs.licenseTypes"), monthlyRate: t("detail.licenses.monthlyRate"), name: t("detail.licenses.name"), noRate: t("detail.licenses.noRate"), openEnded: t("detail.licenses.openEnded"), status: t("detail.licenses.status"), unit: t("detail.licenses.unit"), units: { license: t("detail.licenses.license"), seat: t("detail.licenses.seat") } }, settings: { label: t("detail.tabs.settings"), saved: t("detail.settings.saved") }, tabsLabel: t("detail.tabsLabel") };
}

export function renderVendorAccountsRegistryPage(input: { readonly createAction: VendorAccountFormAction; readonly data: VendorAccountsRegistryPageData; readonly locale: string; readonly t: Translate }) {
  const { createAction, data, locale, t } = input;
  const labels = registryTableLabels(t);
  return <main className="space-y-6 p-4 sm:p-6"><header className="border-b border-border pb-4"><p className="font-mono text-xs uppercase tracking-wide text-text-muted">{t("eyebrow")}</p><h1 className="font-display text-3xl font-semibold text-text-primary">{t("title")}</h1><p className="mt-1 max-w-3xl text-text-secondary">{t("subtitle")}</p></header><section aria-label={t("form.trigger")} className="flex justify-end"><VendorAccountDialog action={createAction} labels={registryFormLabels(t)} vendors={data.vendors} /></section><section aria-labelledby="vendor-accounts-title"><h2 className="font-display text-xl font-semibold text-text-primary" id="vendor-accounts-title">{t("listTitle")}</h2><p className="mt-1 text-sm text-text-secondary">{t("listDescription")}</p><div className="mt-4"><VendorAccountsTable accounts={data.accounts} labels={labels} locale={locale} /></div></section></main>;
}

export function renderVendorAccountDetailPage(input: { readonly data: VendorAccountDetailPageData; readonly locale: string; readonly poolsT: Translate; readonly t: Translate; readonly updateAction: VendorAccountFormAction }) {
  const { data: { at, detail, snapshots }, locale, poolsT, t, updateAction } = input;
  const capabilities = capabilityLabels(t);
  const tabs = detailTabLabels(t, poolsT);
  const renewal = detail.contractRenewalOn ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${detail.contractRenewalOn}T00:00:00.000Z`)) : t("detail.noRenewal");
  const capacity = snapshots.length ? <PoolTiles idPrefix="tile" labels={{ assigned: poolsT("assigned"), free: poolsT("available"), pending: poolsT("pending"), purchased: poolsT("purchased") }} snapshots={snapshots} /> : <div className="rounded border border-dashed border-border p-6 text-center text-text-secondary"><h2 className="font-display text-lg font-semibold text-text-primary">{poolsT("emptyTitle")}</h2><p className="mt-1 text-sm">{poolsT("emptyDescription")}</p></div>;
  return <main className="space-y-6 p-4 sm:p-6"><header className="border-b border-border pb-4"><p className="font-mono text-xs uppercase tracking-wide text-text-muted">{poolsT("detailEyebrow")}</p><h1 className="font-display text-3xl font-semibold text-text-primary">{detail.name}</h1><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-text-muted">{t("detail.account")}</dt><dd className="font-medium text-text-primary">{detail.name}</dd></div><div><dt className="text-text-muted">{t("detail.vendor")}</dt><dd className="font-medium text-text-primary">{detail.vendorName}</dd></div><div><dt className="text-text-muted">{t("detail.mode")}</dt><dd className="font-medium text-text-primary">{t(`modes.${detail.mode}`)}</dd></div><div><dt className="text-text-muted">{t("detail.renewal")}</dt><dd className="font-medium text-text-primary">{renewal}</dd></div></dl><p className="mt-3 text-sm text-text-muted">{poolsT("freshness", { date: poolOperatingDate(at) })}</p></header><CapabilityCard capabilities={detail.capabilities} labels={capabilities} /><VendorAccountTabs account={detail} action={updateAction} capacity={capacity} formLabels={detailFormLabels(t)} labels={tabs} licenseTypes={detail.licenseTypes} locale={locale} /></main>;
}
