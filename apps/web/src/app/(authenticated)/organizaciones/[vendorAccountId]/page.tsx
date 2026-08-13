import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { updateVendorAccount } from "@/modules/vendor-catalog/actions/manage-vendor-accounts";
import { loadVendorAccountDetailPage } from "@/modules/vendor-catalog/vendor-account-page-loaders";
import { renderVendorAccountDetailPage } from "@/modules/vendor-catalog/vendor-account-page-presenters";
import { getPoolRepository } from "@/modules/vendor-catalog/production-pool-repository";
import { getVendorAccountRepository } from "@/modules/vendor-catalog/production-vendor-account-repository";
import { requireVendorAccountAdmin } from "@/modules/vendor-catalog/vendor-account-route-access";

export default async function VendorAccountDetailPage({ params }: {
  readonly params: Promise<{ readonly vendorAccountId: string }>;
}) {
  const authorization = requireVendorAccountAdmin(await loadCurrentLedgerAuthorization());
  const at = new Date();
  const [outcome, t, poolsT, locale] = await Promise.all([
    loadVendorAccountDetailPage({
      at,
      authorization,
      poolRepository: getPoolRepository(),
      rawVendorAccountId: (await params).vendorAccountId,
      vendorAccountRepository: getVendorAccountRepository(),
    }),
    getTranslations("vendorAccounts"),
    getTranslations("pools"),
    getLocale(),
  ]);
  if (outcome.kind === "not-found") notFound();
  const { data } = outcome;
  return renderVendorAccountDetailPage({
    data,
    locale,
    poolsT,
    t,
    updateAction: updateVendorAccount.bind(null, data.detail.id),
  });
}
