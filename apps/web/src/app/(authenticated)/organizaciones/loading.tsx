"use client";

import { useTranslations } from "next-intl";

export function VendorAccountsLoadingView({ label }: { readonly label: string }) {
  return (
    <div
      aria-live="polite"
      className="p-6 text-text-secondary"
      data-testid="vendor_accounts_loading"
      role="status"
    >
      {label}
    </div>
  );
}

export default function VendorAccountsLoading() {
  const t = useTranslations("vendorAccounts");
  return <VendorAccountsLoadingView label={t("loading")} />;
}
