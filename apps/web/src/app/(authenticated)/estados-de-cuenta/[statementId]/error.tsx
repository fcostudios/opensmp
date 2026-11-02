"use client";
import { useTranslations } from "next-intl";
export default function ErrorState({ reset }: { reset: () => void }) {
  const t = useTranslations("statementDetail");
  return <div className="space-y-4 p-6"><p role="alert">{t("loadError")}</p><button className="rounded border border-border px-4 py-2" onClick={reset}>{t("retry")}</button></div>;
}
