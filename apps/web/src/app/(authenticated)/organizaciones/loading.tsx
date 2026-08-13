import { getTranslations } from "next-intl/server";

export default async function VendorAccountsLoading() {
  const t = await getTranslations("vendorAccounts");
  return (
    <div
      aria-live="polite"
      className="p-6 text-text-secondary"
      data-testid="vendor_accounts_loading"
      role="status"
    >
      {t("loading")}
    </div>
  );
}
