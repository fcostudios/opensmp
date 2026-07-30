"use client";

import { useTranslations } from "next-intl";

export default function PeopleError({
  reset,
}: {
  readonly reset: () => void;
}) {
  const t = useTranslations("people");
  return (
    <div
      className="m-6 rounded border border-error-dot bg-error-bg p-4 text-error-text"
      data-testid="people_error"
      role="alert"
    >
      <p>{t("loadError")}</p>
      <button
        className="mt-4 min-h-11 rounded border border-error-dot px-4 font-semibold"
        onClick={reset}
        type="button"
      >
        {t("retry")}
      </button>
    </div>
  );
}
