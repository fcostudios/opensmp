import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { calculateBudgetProjectionCents } from "./budget-math";

function usdText(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const fraction = cents % 100;
  return `${dollars}.${fraction.toString().padStart(2, "0")}`;
}

describe("request budget arithmetic", () => {
  test("adds every representable run rate exactly in integer cents", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999_999 }),
        fc.integer({ min: 0, max: 999_999_999_999 }),
        fc.integer({ min: 0, max: 999_999_999_999 }),
        (budgetCents, committedCents, monthlyRateCents) => {
          const projection = calculateBudgetProjectionCents({
            budgetMonthlyUsd: usdText(budgetCents),
            committedRunRateUsd: usdText(committedCents),
            monthlyRateUsd: usdText(monthlyRateCents),
          });

          expect(projection.projectedRunRateCents).toBe(
            committedCents + monthlyRateCents,
          );
          expect(projection.exceedsBudget).toBe(
            committedCents + monthlyRateCents > budgetCents,
          );
        },
      ),
      { seed: 12_012, numRuns: 500 },
    );
  });

  test("preserves headroom when the same cent delta is added to budget and commitments", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000_000_000 }),
        fc.integer({ min: 0, max: 500_000_000_000 }),
        fc.integer({ min: 0, max: 500_000_000_000 }),
        fc.integer({ min: 0, max: 499_999_999_999 }),
        (budgetCents, committedCents, monthlyRateCents, deltaCents) => {
          const original = calculateBudgetProjectionCents({
            budgetMonthlyUsd: usdText(budgetCents),
            committedRunRateUsd: usdText(committedCents),
            monthlyRateUsd: usdText(monthlyRateCents),
          });
          const translated = calculateBudgetProjectionCents({
            budgetMonthlyUsd: usdText(budgetCents + deltaCents),
            committedRunRateUsd: usdText(committedCents + deltaCents),
            monthlyRateUsd: usdText(monthlyRateCents),
          });

          expect(
            (budgetCents + deltaCents) -
              translated.projectedRunRateCents,
          ).toBe(budgetCents - original.projectedRunRateCents);
          expect(translated.exceedsBudget).toBe(original.exceedsBudget);
        },
      ),
      { seed: 12_013, numRuns: 500 },
    );
  });

  test.each([
    {
      name: "zero values",
      budgetMonthlyUsd: "0.00",
      committedRunRateUsd: "0.00",
      monthlyRateUsd: "0.00",
      projectedRunRateCents: 0,
      exceedsBudget: false,
    },
    {
      name: "exact budget boundary",
      budgetMonthlyUsd: "100.00",
      committedRunRateUsd: "99.99",
      monthlyRateUsd: "0.01",
      projectedRunRateCents: 10_000,
      exceedsBudget: false,
    },
    {
      name: "one cent over budget",
      budgetMonthlyUsd: "100.00",
      committedRunRateUsd: "99.99",
      monthlyRateUsd: "0.02",
      projectedRunRateCents: 10_001,
      exceedsBudget: true,
    },
    {
      name: "single decimal PostgreSQL text",
      budgetMonthlyUsd: "0.3",
      committedRunRateUsd: "0.1",
      monthlyRateUsd: "0.2",
      projectedRunRateCents: 30,
      exceedsBudget: false,
    },
    {
      name: "integer zero fallback",
      budgetMonthlyUsd: "1.00",
      committedRunRateUsd: "0",
      monthlyRateUsd: "1.00",
      projectedRunRateCents: 100,
      exceedsBudget: false,
    },
  ])(
    "handles the $name",
    ({
      budgetMonthlyUsd,
      committedRunRateUsd,
      monthlyRateUsd,
      projectedRunRateCents,
      exceedsBudget,
    }) => {
      expect(
        calculateBudgetProjectionCents({
          budgetMonthlyUsd,
          committedRunRateUsd,
          monthlyRateUsd,
        }),
      ).toEqual({ projectedRunRateCents, exceedsBudget });
    },
  );
});
