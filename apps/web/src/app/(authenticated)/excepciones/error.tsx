"use client";

import { useTranslations } from "next-intl";

export default function ExceptionsError({
  reset,
}: {
  readonly reset: () => void;
}) {
  const t = useTranslations("exceptions");
  return (
    <main className="p-4 sm:p-6">
      <div className="rounded border border-border bg-surface p-6" role="alert">
        <p className="text-text-primary">{t("error")}</p>
        <button
          className="mt-4 rounded border border-border px-3 py-2 font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={reset}
          type="button"
        >
          {t("retry")}
        </button>
      </div>
    </main>
  );
}
