import { describe, expect, it } from "vitest";

import { createAnthropicRateLimiter } from "./rate-limiter.js";

type ManualTime = {
  advance(milliseconds: number): void;
  now(): number;
  readonly sleeps: number[];
};

function manualTime(initialNow = 0): ManualTime {
  let now = initialNow;
  const sleeps: number[] = [];

  return {
    advance(milliseconds) {
      now += milliseconds;
    },
    now: () => now,
    sleeps,
  };
}

function limiterWithManualTime(time: ManualTime) {
  return createAnthropicRateLimiter({
    clock: { now: time.now },
    sleep: async (milliseconds) => {
      time.sleeps.push(milliseconds);
      time.advance(milliseconds);
    },
  });
}

async function fill(
  acquire: (budgets: readonly ("user_management" | "analytics" | "invite_create")[]) => Promise<void>,
  budgets: readonly ("user_management" | "analytics" | "invite_create")[],
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    await acquire(budgets);
  }
}

describe("Anthropic per-account sliding-window rate limiter", () => {
  it("waits exactly one user-management window after its 100th acquisition", async () => {
    // Mutation killed: changing the user-management limit or window fails this literal boundary.
    const time = manualTime();
    const limiter = limiterWithManualTime(time);

    await fill((budgets) => limiter.acquire("account-a", budgets), ["user_management"], 100);
    expect(time.sleeps).toEqual([]);

    await limiter.acquire("account-a", ["user_management"]);
    expect(time.sleeps).toEqual([60_000]);
  });

  it("waits exactly one analytics window after its 60th acquisition", async () => {
    // Mutation killed: changing the analytics limit or window fails this literal boundary.
    const time = manualTime();
    const limiter = limiterWithManualTime(time);

    await fill((budgets) => limiter.acquire("account-a", budgets), ["analytics"], 60);
    await limiter.acquire("account-a", ["analytics"]);

    expect(time.sleeps).toEqual([60_000]);
  });

  it("waits exactly one invite-create window after its 1,200th acquisition", async () => {
    // Mutation killed: changing the invite-create limit or window fails this literal boundary.
    const time = manualTime();
    const limiter = limiterWithManualTime(time);

    await fill((budgets) => limiter.acquire("account-a", budgets), ["invite_create"], 1_200);
    await limiter.acquire("account-a", ["invite_create"]);

    expect(time.sleeps).toEqual([3_600_000]);
  });

  it("does not record user-management before a blocked invite budget has capacity", async () => {
    // Mutation killed: recording any requested budget before every budget has capacity exhausts user-management early.
    const time = manualTime();
    const limiter = limiterWithManualTime(time);

    await fill((budgets) => limiter.acquire("account-a", budgets), ["invite_create"], 1_200);
    time.advance(3_599_999);
    await limiter.acquire("account-a", ["user_management", "invite_create"]);
    expect(time.sleeps).toEqual([1]);

    await fill((budgets) => limiter.acquire("account-a", budgets), ["user_management"], 99);
    expect(time.sleeps).toEqual([1]);
  });

  it("keeps the window open through oldest plus window minus one millisecond", async () => {
    // Mutation killed: treating the window end as inclusive fails the one-millisecond wait.
    const time = manualTime();
    const limiter = limiterWithManualTime(time);

    await fill((budgets) => limiter.acquire("account-a", budgets), ["user_management"], 100);
    time.advance(59_999);
    await limiter.acquire("account-a", ["user_management"]);

    expect(time.sleeps).toEqual([1]);
  });

  it("expires the oldest acquisition exactly at the window boundary", async () => {
    // Mutation killed: retaining timestamps at oldest plus window fails this no-wait rollover.
    const time = manualTime();
    const limiter = limiterWithManualTime(time);

    await fill((budgets) => limiter.acquire("account-a", budgets), ["user_management"], 100);
    time.advance(60_000);
    await limiter.acquire("account-a", ["user_management"]);

    expect(time.sleeps).toEqual([]);
  });

  it("isolates budget windows by vendor account", async () => {
    // Mutation killed: using a global budget key makes account-b wait for account-a.
    const time = manualTime();
    const limiter = limiterWithManualTime(time);

    await fill((budgets) => limiter.acquire("account-a", budgets), ["user_management"], 100);
    await limiter.acquire("account-b", ["user_management"]);

    expect(time.sleeps).toEqual([]);
  });

  it("serializes concurrent acquisitions for one account in FIFO order", async () => {
    // Mutation killed: dropping the account mutex permits both callers to enter the held sleep.
    const time = manualTime();
    let releaseSleep: (() => void) | undefined;
    let signalSleepStarted: (() => void) | undefined;
    const sleepStarted = new Promise<void>((resolve) => {
      releaseSleep = resolve;
    });
    const sleeperEntered = new Promise<void>((resolve) => {
      signalSleepStarted = resolve;
    });
    const sleeps: number[] = [];
    const limiter = createAnthropicRateLimiter({
      clock: { now: time.now },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        signalSleepStarted?.();
        await sleepStarted;
        time.advance(milliseconds);
      },
    });

    await fill((budgets) => limiter.acquire("account-a", budgets), ["user_management"], 100);
    const first = limiter.acquire("account-a", ["user_management"]);
    const second = limiter.acquire("account-a", ["user_management"]);

    await sleeperEntered;
    expect(sleeps).toEqual([60_000]);

    releaseSleep?.();
    await Promise.all([first, second]);
    expect(sleeps).toEqual([60_000]);
  });

  it("recovers the account queue after a rejected sleeper", async () => {
    // Mutation killed: retaining a rejected promise tail prevents the following caller from acquiring.
    const time = manualTime();
    let rejectFirstSleep = true;
    const limiter = createAnthropicRateLimiter({
      clock: { now: time.now },
      sleep: async (milliseconds) => {
        if (rejectFirstSleep) {
          rejectFirstSleep = false;
          throw new Error("synthetic sleeper failure");
        }
        time.advance(milliseconds);
      },
    });

    await fill((budgets) => limiter.acquire("account-a", budgets), ["user_management"], 100);
    await expect(limiter.acquire("account-a", ["user_management"])).rejects.toThrow("synthetic sleeper failure");
    await expect(limiter.acquire("account-a", ["user_management"])).resolves.toBeUndefined();
  });

  it.each([
    ["blank account", "   ", ["user_management"]],
    ["empty budget list", "account-a", []],
    ["duplicate budget", "account-a", ["analytics", "analytics"]],
    ["unknown budget", "account-a", ["unknown"]],
  ] as const)("rejects a %s fail-closed", async (_case, accountId, budgets) => {
    const limiter = limiterWithManualTime(manualTime());

    await expect(limiter.acquire(accountId, budgets as never)).rejects.toThrow();
  });
});
