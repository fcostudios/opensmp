import type { UiLocale } from "./freshness-label";

export function formatUsd(amount: number, locale: UiLocale): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    currencyDisplay: locale === "es-EC" ? "code" : "symbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function MoneyText({
  amount,
  locale,
  total = false,
}: {
  amount: number;
  locale: UiLocale;
  total?: boolean;
}) {
  return (
    <span
      className={`block text-right font-mono tabular-nums${total ? " font-semibold" : ""}`}
    >
      {formatUsd(amount, locale)}
    </span>
  );
}
