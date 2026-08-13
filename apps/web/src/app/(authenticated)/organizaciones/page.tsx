import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { VendorAccountDialog } from "@/components/vendor-accounts/vendor-account-dialog";
import type { VendorAccountFormLabels } from "@/components/vendor-accounts/vendor-account-form";
import {
  VendorAccountsTable,
  type VendorAccountsTableLabels,
} from "@/components/vendor-accounts/vendor-accounts-table";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { createVendorAccount } from "@/modules/vendor-catalog/actions/manage-vendor-accounts";
import { getVendorAccountRepository } from "@/modules/vendor-catalog/production-vendor-account-repository";

export default async function VendorAccountsPage() {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || authorization.globalRole !== "group_admin") {
    redirect(ROUTE_SCR_ACCESS_DENIED);
  }

  const repository = getVendorAccountRepository();
  const [accounts, vendors, t, locale] = await Promise.all([
    repository.list(authorization, new Date()),
    repository.activeAnthropicOptions(authorization),
    getTranslations("vendorAccounts"),
    getLocale(),
  ]);

  const tableLabels: VendorAccountsTableLabels = {
    columns: {
      connector: t("columns.connector"),
      credential: t("columns.credential"),
      floor: t("columns.floor"),
      mode: t("columns.mode"),
      name: t("columns.name"),
      renewal: t("columns.renewal"),
      seats: t("columns.seats"),
      status: t("columns.status"),
      vendor: t("columns.vendor"),
    },
    connector: {
      api: t("connector.api"),
      manual: t("connector.manual"),
      orchestration: t("connector.orchestration"),
    },
    credential: {
      auth_failed: t("credential.auth_failed"),
      none: t("credential.none"),
      ok: t("credential.ok"),
      unverified: t("credential.unverified"),
    },
    empty: t("empty"),
    modes: {
      automated: t("modes.automated"),
      orchestration: t("modes.orchestration"),
    },
    noRenewal: t("noRenewal"),
    protocol: {
      none: t("protocol.none"),
      rest: t("protocol.rest"),
      scim: t("protocol.scim"),
    },
    seatsPattern: t("seatsPattern", { free: "{free}", purchased: "{purchased}" }),
    status: {
      active: t("status.active"),
      inactive: t("status.inactive"),
    },
    tableCaption: t("tableCaption"),
    viewAccount: t("viewAccount"),
  };
  const formLabels: VendorAccountFormLabels = {
    cancel: t("form.cancel"),
    description: t("form.description"),
    errors: {
      contractRenewalOn: t("form.errors.contractRenewalOn"),
      duplicate: t("form.errors.duplicate"),
      generic: t("form.errors.generic"),
      lowPoolFloor: t("form.errors.lowPoolFloor"),
      mode: t("form.errors.mode"),
      name: t("form.errors.name"),
      vendorId: t("form.errors.vendorId"),
      vendorOrgRef: t("form.errors.vendorOrgRef"),
    },
    fields: {
      contractRenewalOn: t("form.fields.contractRenewalOn"),
      lowPoolFloor: t("form.fields.lowPoolFloor"),
      mode: t("form.fields.mode"),
      name: t("form.fields.name"),
      vendorId: t("form.fields.vendorId"),
      vendorOrgRef: t("form.fields.vendorOrgRef"),
    },
    help: {
      lowPoolFloor: t("form.help.lowPoolFloor"),
      vendor: t("form.help.vendor"),
      vendorOrgRef: t("form.help.vendorOrgRef"),
    },
    modes: {
      automated: t("form.modes.automated"),
      orchestration: t("form.modes.orchestration"),
    },
    submit: t("form.submit"),
    submitting: t("form.submitting"),
    success: t("form.success"),
    title: t("form.title"),
    trigger: t("form.trigger"),
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">{t("eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-text-secondary">{t("subtitle")}</p>
      </header>

      <section aria-label={t("form.trigger")} className="flex justify-end">
        <VendorAccountDialog action={createVendorAccount} labels={formLabels} vendors={vendors} />
      </section>

      <section aria-labelledby="vendor-accounts-title">
        <h2 className="font-display text-xl font-semibold text-text-primary" id="vendor-accounts-title">{t("listTitle")}</h2>
        <p className="mt-1 text-sm text-text-secondary">{t("listDescription")}</p>
        <div className="mt-4">
          <VendorAccountsTable accounts={accounts} labels={tableLabels} locale={locale} />
        </div>
      </section>
    </main>
  );
}
