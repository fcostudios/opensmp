"use client";

import { useTranslations } from "next-intl";

export default function RequestListError({
  reset,
}: {
  readonly reset: () => void;
}) {
  const t = useTranslations("requestHistory");
  return (
    <section
      className="m-6 rounded-lg border border-error-dot bg-error-bg p-6 text-error-text"
      data-testid="requests_error"
    >
      <p>{t("error")}</p>
      <button
        className="mt-4 min-h-11 rounded border border-border bg-surface px-4 font-semibold"
        onClick={reset}
        type="button"
      >
        {t("filters")}
      </button>
    </section>
  );
}
