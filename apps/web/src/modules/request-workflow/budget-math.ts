export interface BudgetProjectionInput {
  readonly budgetMonthlyUsd: string;
  readonly committedRunRateUsd: string;
  readonly monthlyRateUsd: string;
}

export interface BudgetProjectionCents {
  readonly projectedRunRateCents: number;
  readonly exceedsBudget: boolean;
}

function postgresUsdToCents(amountUsd: string): number {
  const [dollars, fraction = ""] = amountUsd.split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
}

export function calculateBudgetProjectionCents({
  budgetMonthlyUsd,
  committedRunRateUsd,
  monthlyRateUsd,
}: BudgetProjectionInput): BudgetProjectionCents {
  const budgetCents = postgresUsdToCents(budgetMonthlyUsd);
  const projectedRunRateCents =
    postgresUsdToCents(committedRunRateUsd) +
    postgresUsdToCents(monthlyRateUsd);

  return {
    projectedRunRateCents,
    exceedsBudget: projectedRunRateCents > budgetCents,
  };
}
