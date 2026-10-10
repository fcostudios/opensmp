"use client";
import { useTranslations } from "next-intl";
export default function UsageError({ reset }: { error?: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("usage");
  return <section className="m-6 rounded border border-error-dot bg-error-bg p-4 text-error-text" role="alert" data-testid="usage_error"><p>{t("loadError")}</p><button className="mt-4 min-h-11 rounded border border-error-dot px-4 font-semibold" type="button" onClick={reset}>{t("retry")}</button></section>;
}
