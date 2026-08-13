"use client";

import { useTranslations } from "next-intl";

export default function VendorAccountsError({
  reset,
}: {
  readonly reset: () => void;
}) {
  const t = useTranslations("vendorAccounts");
  return <VendorAccountsErrorView loadError={t("loadError")} reset={reset} retry={t("retry")} />;
}

export function VendorAccountsErrorView({
  loadError,
  reset,
  retry,
}: {
  readonly loadError: string;
  readonly reset: () => void;
  readonly retry: string;
}) {
  return (
    <div
      className="m-6 rounded border border-error-dot bg-error-bg p-4 text-error-text"
      data-testid="vendor_accounts_error"
      role="alert"
    >
      <p>{loadError}</p>
      <button
        className="mt-4 min-h-11 rounded border border-error-dot px-4 font-semibold"
        onClick={reset}
        type="button"
      >
        {retry}
      </button>
    </div>
  );
}
