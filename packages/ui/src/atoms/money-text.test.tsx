import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { formatUsd, MoneyText } from "./money-text";

describe("MoneyText", () => {
  test.each([
    ["es-EC", 27.1, "USD\u00a027,10"],
    ["en-US", 27.1, "$27.10"],
    ["es-EC", 0, "USD\u00a00,00"],
    ["en-US", -27.1, "-$27.10"],
  ] as const)("formats %s USD amounts using the locale contract", (locale, amount, expected) => {
    expect(formatUsd(amount, locale)).toBe(expected);
  });

  test("matches Intl USD formatting for arbitrary cent amounts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.constantFrom("es-EC", "en-US"),
        (cents, locale) => {
          const amount = cents / 100;
          const reference = new Intl.NumberFormat(locale, {
            style: "currency",
            currency: "USD",
            currencyDisplay: locale === "es-EC" ? "code" : "symbol",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(amount);
          expect(formatUsd(amount, locale)).toBe(reference);
        },
      ),
      { seed: 2_607_25, numRuns: 200 },
    );
  });

  test("renders money with mono, tabular, and right-aligned presentation", () => {
    const markup = renderToStaticMarkup(
      <MoneyText amount={27.1} locale="es-EC" />,
    );

    expect(markup).toContain("font-mono");
    expect(markup).toContain("tabular-nums");
    expect(markup).toContain("text-right");
    expect(markup).toContain("USD");
  });
});
