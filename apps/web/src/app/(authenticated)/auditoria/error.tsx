"use client";

import { useTranslations } from "next-intl";

export default function AuditError({
  reset,
}: {
  readonly reset: () => void;
}) {
  const t = useTranslations("audit");
  return (
    <div
      className="m-6 rounded border border-border bg-error-bg p-4 text-error-text"
      data-testid="audit_error"
      role="alert"
    >
      <p>{t("error")}</p>
      <button
        className="mt-4 min-h-11 rounded border border-border px-4"
        onClick={reset}
        type="button"
      >
        {t("retry")}
      </button>
    </div>
  );
}

