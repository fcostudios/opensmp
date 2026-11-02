"use client";

import { useTranslations } from "next-intl";

/**
 * US-098: "active in month" register filter. A calendar month (YYYY-MM); the
 * repository returns every assignment active on at least one day of it — the
 * same set the license-only close bills for that period.
 */
export function RegisterActiveMonthFilter({ value }: { readonly value: string | undefined }) {
  const t = useTranslations("register");
  return (
    <div className="grid gap-1 text-sm text-text-secondary">
      <label className="grid gap-1">
        {t("activeMonth")}
        <input
          aria-describedby="register-active-month-hint"
          className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
          defaultValue={value ?? ""}
          name="activeMonth"
          pattern="[0-9]{4}-[0-9]{2}"
          placeholder="YYYY-MM"
          type="month"
        />
      </label>
      <span className="text-xs text-text-muted" id="register-active-month-hint">{t("activeMonthHint")}</span>
    </div>
  );
}
