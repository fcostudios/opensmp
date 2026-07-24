import { describe, expect, it } from "vitest";

import { createWorkerLifecycle } from "./index";

describe("worker lifecycle", () => {
  it("connects, emits the initial heartbeat, and closes cleanly on shutdown", async () => {
    const events: string[] = [];
    let scheduledHeartbeat: (() => void | Promise<void>) | undefined;
    const lifecycle = createWorkerLifecycle({
      clearHeartbeat: () => events.push("clear"),
      connect: async () => events.push("connect"),
      disconnect: async () => events.push("disconnect"),
      scheduleHeartbeat: (heartbeat, intervalMs) => {
        events.push(`schedule:${intervalMs}`);
        scheduledHeartbeat = heartbeat;
        return "heartbeat-timer";
      },
      touchHeartbeat: async () => events.push("touch"),
    });

    await lifecycle.start();
    await scheduledHeartbeat?.();
    await lifecycle.stop();

    expect(events).toEqual([
      "connect",
      "touch",
      "schedule:60000",
      "touch",
      "clear",
      "disconnect",
    ]);
  });
});
