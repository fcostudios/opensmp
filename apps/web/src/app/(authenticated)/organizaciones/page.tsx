import { getLocale, getTranslations } from "next-intl/server";

import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { createVendorAccount } from "@/modules/vendor-catalog/actions/manage-vendor-accounts";
import { loadVendorAccountsRegistryPage } from "@/modules/vendor-catalog/vendor-account-page-loaders";
import { renderVendorAccountsRegistryPage } from "@/modules/vendor-catalog/vendor-account-page-presenters";
import { getVendorAccountRepository } from "@/modules/vendor-catalog/production-vendor-account-repository";
import { requireVendorAccountAdmin } from "@/modules/vendor-catalog/vendor-account-route-access";

export default async function VendorAccountsPage() {
  const authorization = requireVendorAccountAdmin(await loadCurrentLedgerAuthorization());
  const [data, t, locale] = await Promise.all([
    loadVendorAccountsRegistryPage({ at: new Date(), authorization, repository: getVendorAccountRepository() }),
    getTranslations("vendorAccounts"),
    getLocale(),
  ]);
  return renderVendorAccountsRegistryPage({ createAction: createVendorAccount, data, locale, t });
}
