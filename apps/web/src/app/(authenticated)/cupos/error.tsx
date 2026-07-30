"use client";

import { useTranslations } from "next-intl";

export default function PoolsError({
  reset,
}: {
  readonly reset: () => void;
}) {
  const t = useTranslations("pools");
  return (
    <section
      className="m-6 rounded border border-border bg-error-bg p-6 text-error-text"
      role="alert"
    >
      <p>{t("loadError")}</p>
      <button
        className="mt-4 min-h-11 rounded border border-border bg-surface px-4"
        onClick={reset}
        type="button"
      >
        {t("retry")}
      </button>
    </section>
  );
}
