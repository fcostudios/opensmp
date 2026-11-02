"use client";
import { useTranslations } from "next-intl";
export default function ErrorState({ reset }: { reset: () => void }) {
  const t = useTranslations("statements");
  return <div className="space-y-4 p-6"><p role="alert">{t("loadError")}</p><button onClick={reset}>{t("retry")}</button></div>;
}
