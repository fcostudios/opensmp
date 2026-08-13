"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";

import type { VendorAccountDetail } from "@/modules/vendor-catalog/vendor-account-repository";

import { VendorAccountForm, type VendorAccountFormAction, type VendorAccountFormLabels } from "./vendor-account-form";

type TabId = "capacity" | "licenseTypes" | "settings";

export interface VendorAccountTabsLabels {
  readonly capacity: { readonly empty: string; readonly label: string };
  readonly licenses: {
    readonly active: string;
    readonly caption: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string;
    readonly inactive: string;
    readonly label: string;
    readonly monthlyRate: string;
    readonly name: string;
    readonly noRate: string;
    readonly openEnded: string;
    readonly status: string;
    readonly unit: string;
    readonly units: { readonly license: string; readonly seat: string };
  };
  readonly settings: { readonly label: string; readonly saved: string };
  readonly tabsLabel: string;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function LicenseTypes({ labels, licenseTypes, locale }: {
  readonly labels: VendorAccountTabsLabels["licenses"];
  readonly licenseTypes: VendorAccountDetail["licenseTypes"];
  readonly locale: string;
}) {
  const currency = new Intl.NumberFormat(locale, { currency: "USD", style: "currency" });
  return (
    <div className="overflow-x-auto rounded border border-border bg-surface">
      <table aria-label={labels.caption} className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{labels.caption}</caption>
        <thead><tr className="border-b border-border text-text-muted">
          <th className="p-3" scope="col">{labels.name}</th><th className="p-3" scope="col">{labels.unit}</th><th className="p-3" scope="col">{labels.status}</th><th className="p-3" scope="col">{labels.monthlyRate}</th><th className="p-3" scope="col">{labels.effectiveFrom}</th><th className="p-3" scope="col">{labels.effectiveTo}</th>
        </tr></thead>
        <tbody>{licenseTypes.map((license) => {
          const hasCurrentRate = license.monthlyRateUsd !== null;
          return <tr className="border-b border-border last:border-0" key={license.id}>
          <th className="p-3 font-medium text-text-primary" scope="row">{license.name}</th>
          <td className="p-3">{labels.units[license.unit]}</td>
          <td className="p-3">{license.status === "active" ? labels.active : labels.inactive}</td>
          <td className="p-3 font-mono">{hasCurrentRate ? currency.format(Number(license.monthlyRateUsd)) : labels.noRate}</td>
          <td className="p-3">{hasCurrentRate && license.rateEffectiveFrom !== null ? formatDate(license.rateEffectiveFrom, locale) : labels.noRate}</td>
          <td className="p-3">{!hasCurrentRate ? labels.noRate : license.rateEffectiveTo === null ? labels.openEnded : formatDate(license.rateEffectiveTo, locale)}</td>
        </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

export function VendorAccountTabs({ account, action, capacity, formLabels, labels, licenseTypes, locale }: {
  readonly account: Pick<VendorAccountDetail, "contractRenewalOn" | "id" | "lowPoolFloor" | "mode" | "name" | "status" | "vendorId" | "vendorName" | "vendorOrgRef">;
  readonly action: VendorAccountFormAction;
  readonly capacity: ReactNode;
  readonly formLabels: VendorAccountFormLabels;
  readonly labels: VendorAccountTabsLabels;
  readonly licenseTypes: VendorAccountDetail["licenseTypes"];
  readonly locale: string;
}) {
  const [active, setActive] = useState<TabId>("capacity");
  const [saved, setSaved] = useState(false);
  const tabs: readonly { readonly id: TabId; readonly label: string }[] = [
    { id: "capacity", label: labels.capacity.label },
    { id: "licenseTypes", label: labels.licenses.label },
    { id: "settings", label: labels.settings.label },
  ];

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next]!;
    setActive(tab.id);
    document.getElementById(`vendor-tab-${tab.id}`)?.focus();
  }

  return <section>
    <div aria-label={labels.tabsLabel} className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
      {tabs.map((tab, index) => <button aria-controls={`vendor-panel-${tab.id}`} aria-selected={active === tab.id} className="min-h-11 whitespace-nowrap border-b-2 border-transparent px-4 font-medium text-text-secondary aria-selected:border-primary aria-selected:text-primary" id={`vendor-tab-${tab.id}`} key={tab.id} onClick={() => setActive(tab.id)} onKeyDown={(event) => move(event, index)} role="tab" tabIndex={active === tab.id ? 0 : -1} type="button">{tab.label}</button>)}
    </div>
    <div aria-labelledby="vendor-tab-capacity" className="pt-5" hidden={active !== "capacity"} id="vendor-panel-capacity" role="tabpanel" tabIndex={active === "capacity" ? 0 : -1}>
      {capacity}
    </div>
    <div aria-labelledby="vendor-tab-licenseTypes" className="pt-5" hidden={active !== "licenseTypes"} id="vendor-panel-licenseTypes" role="tabpanel" tabIndex={active === "licenseTypes" ? 0 : -1}>
      <LicenseTypes labels={labels.licenses} licenseTypes={licenseTypes} locale={locale} />
    </div>
    <div aria-labelledby="vendor-tab-settings" className="pt-5" hidden={active !== "settings"} id="vendor-panel-settings" role="tabpanel" tabIndex={active === "settings" ? 0 : -1}>
      <div className="max-w-3xl">
        {saved ? <p className="mb-4 rounded bg-success-bg p-3 text-sm text-success-text" role="status">{labels.settings.saved}</p> : null}
        <VendorAccountForm action={action} initialValues={account} labels={formLabels} onCancel={() => undefined} onDirtyChange={(dirty) => { if (dirty) setSaved(false); }} onPendingChange={(pending) => { if (pending) setSaved(false); }} onSuccess={() => setSaved(true)} onValuesChange={() => setSaved(false)} showCancel={false} vendorName={account.vendorName} />
      </div>
    </div>
  </section>;
}
