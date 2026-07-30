import { describe, expect, test, vi } from "vitest";

import { createLifecycleNotificationDrainLoop } from "./lifecycle-notification-drain.js";

describe("lifecycle notification drain loop", () => {
  test("drains immediately, prevents overlap, and closes gracefully", async () => {
    let release!: () => void;
    const drain = vi.fn(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const close = vi.fn(async () => undefined);
    const clearIntervalFn = vi.fn();
    let tick!: () => void;
    let scheduledDelay = 0;
    let scheduleCount = 0;
    const loop = createLifecycleNotificationDrainLoop({
      batchSize: 23,
      dispatcher: { close, drain },
      intervalMs: 1_000,
      setIntervalFn: (callback, delay) => {
        scheduleCount += 1;
        tick = callback;
        scheduledDelay = Number(delay);
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn,
      onError: vi.fn(),
    });

    loop.start();
    loop.start();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledWith({ limit: 23 }));
    expect(scheduledDelay).toBe(1_000);
    expect(scheduleCount).toBe(1);
    tick();
    expect(drain).toHaveBeenCalledOnce();

    const stopped = loop.stop();
    expect(close).not.toHaveBeenCalled();
    release();
    await stopped;
    expect(clearIntervalFn).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    tick();
    expect(drain).toHaveBeenCalledOnce();
  });

  test("reports a failed pass and continues on the next cadence", async () => {
    const onError = vi.fn();
    const drain = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary database outage"))
      .mockResolvedValueOnce({ failed: 0, sent: 1, skipped: 0 });
    let tick!: () => void;
    let scheduledDelay = 0;
    const loop = createLifecycleNotificationDrainLoop({
      dispatcher: { close: vi.fn(async () => undefined), drain },
      onError,
      setIntervalFn: (callback, delay) => {
        tick = callback;
        scheduledDelay = Number(delay);
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
    });

    loop.start();
    expect(scheduledDelay).toBe(60_000);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    tick();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(2));
    await loop.stop();
  });

  test("closes safely when stopped before it is started", async () => {
    const close = vi.fn(async () => undefined);
    const clearIntervalFn = vi.fn();
    const loop = createLifecycleNotificationDrainLoop({
      clearIntervalFn,
      dispatcher: {
        close,
        drain: vi.fn(async () => undefined),
      },
      onError: vi.fn(),
    });

    await loop.stop();

    expect(clearIntervalFn).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
