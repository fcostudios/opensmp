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
