"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import type { StoredLocale } from "@smp/contracts";

export function LocaleSelector({
  updateLocaleAction,
}: {
  updateLocaleAction: (input: { locale: StoredLocale }) => Promise<void>;
}) {
  const t = useTranslations();
  const currentLocale: StoredLocale = useLocale() === "en-US" ? "en" : "es";
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label={t("shell.language")}
      value={currentLocale}
      disabled={isPending}
      className="min-h-[var(--size-tap-target-min)] rounded-md border border-border bg-surface px-2 text-sm font-semibold text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
      onChange={(event) => {
        const locale = event.currentTarget.value as StoredLocale;
        startTransition(() => updateLocaleAction({ locale }));
      }}
    >
      <option value="es">{t("locale.es")}</option>
      <option value="en">{t("locale.en")}</option>
    </select>
  );
}
