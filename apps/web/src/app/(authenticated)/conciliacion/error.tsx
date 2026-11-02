"use client";
import { useLocale } from "@/lib/i18n/use-locale";
import type messages from "@/lib/i18n/en-US.json";
export default function Error({ reset }: { reset: () => void }) {
  const {t:dictionary}=useLocale();const t=dictionary.reconciliation as typeof messages.reconciliation;
  return <div role="alert" className="space-y-4 p-6"><p>{t.error}</p><button type="button" onClick={reset}>{t.retry}</button></div>;
}
