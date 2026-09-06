import type { AnthropicBudgetKind } from "./endpoints.js";

export type AnthropicClock = Readonly<{ now(): number }>;

export type AnthropicSleep = (milliseconds: number) => Promise<void>;

export interface AnthropicRateLimiter {
  acquire(vendorAccountId: string, budgets: readonly AnthropicBudgetKind[]): Promise<void>;
}

type BudgetWindow = Readonly<{
  limit: number;
  windowMilliseconds: number;
}>;

const BUDGET_WINDOWS: Readonly<Record<AnthropicBudgetKind, BudgetWindow>> = Object.freeze({
  user_management: Object.freeze({ limit: 100, windowMilliseconds: 60_000 }),
  analytics: Object.freeze({ limit: 60, windowMilliseconds: 60_000 }),
  invite_create: Object.freeze({ limit: 1_200, windowMilliseconds: 3_600_000 }),
});

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validBudgets(value: readonly AnthropicBudgetKind[]): AnthropicBudgetKind[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Anthropic rate limiter requires at least one budget.");
  }

  const budgets: AnthropicBudgetKind[] = [];
  const seen = new Set<AnthropicBudgetKind>();
  for (const budget of value) {
    if (!Object.prototype.hasOwnProperty.call(BUDGET_WINDOWS, budget)) {
      throw new Error("Anthropic rate limiter received an unknown budget.");
    }
    if (seen.has(budget)) {
      throw new Error("Anthropic rate limiter received a duplicate budget.");
    }
    seen.add(budget);
    budgets.push(budget);
  }
  return budgets;
}

export function createAnthropicRateLimiter(input: Readonly<{
  clock: AnthropicClock;
  sleep: AnthropicSleep;
}>): AnthropicRateLimiter {
  const timestamps = new Map<string, Map<AnthropicBudgetKind, number[]>>();
  const tails = new Map<string, Promise<void>>();

  function accountTimestamps(vendorAccountId: string): Map<AnthropicBudgetKind, number[]> {
    let account = timestamps.get(vendorAccountId);
    if (!account) {
      account = new Map();
      timestamps.set(vendorAccountId, account);
    }
    return account;
  }

  async function acquireWithinAccount(
    vendorAccountId: string,
    budgets: readonly AnthropicBudgetKind[],
  ): Promise<void> {
    const account = accountTimestamps(vendorAccountId);

    for (;;) {
      const now = input.clock.now();
      let waitMilliseconds = 0;

      for (const budget of budgets) {
        const window = BUDGET_WINDOWS[budget];
        const active = (account.get(budget) ?? []).filter(
          (timestamp) => timestamp > now - window.windowMilliseconds,
        );
        account.set(budget, active);

        if (active.length >= window.limit) {
          waitMilliseconds = Math.max(
            waitMilliseconds,
            active[0]! + window.windowMilliseconds - now,
          );
        }
      }

      if (waitMilliseconds > 0) {
        await input.sleep(waitMilliseconds);
        continue;
      }

      for (const budget of budgets) {
        account.get(budget)!.push(now);
      }
      return;
    }
  }

  return {
    async acquire(vendorAccountId, requestedBudgets) {
      if (!nonblank(vendorAccountId)) {
        throw new Error("Anthropic rate limiter requires a nonblank vendor account.");
      }
      const budgets = validBudgets(requestedBudgets);
      const previous = tails.get(vendorAccountId) ?? Promise.resolve();
      const acquisition = previous
        .catch(() => undefined)
        .then(() => acquireWithinAccount(vendorAccountId, budgets));
      tails.set(vendorAccountId, acquisition.then(() => undefined, () => undefined));
      return acquisition;
    },
  };
}
