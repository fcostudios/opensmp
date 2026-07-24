import { describe, expect, it } from "vitest";

import { createWorkerClient, createWorkerLifecycle } from "./index";

describe("worker lifecycle", () => {
  it("stops after a scheduled heartbeat fails so Compose can restart the worker", async () => {
    let scheduledHeartbeat: (() => void | Promise<void>) | undefined;
    const events: string[] = [];
    let heartbeatCount = 0;
    let lifecycle: ReturnType<typeof createWorkerLifecycle>;
    lifecycle = createWorkerLifecycle({
      clearHeartbeat: () => events.push("clear"),
      connect: async () => events.push("connect"),
      disconnect: async () => events.push("disconnect"),
      onHeartbeatFailure: async () => {
        events.push("failed");
        await lifecycle.stop();
      },
      scheduleHeartbeat: (heartbeat) => {
        scheduledHeartbeat = heartbeat;
        return "heartbeat-timer";
      },
      touchHeartbeat: async () => {
        heartbeatCount += 1;
        if (heartbeatCount > 1) throw new Error("database connection lost");
      },
    });

    await lifecycle.start();
    await scheduledHeartbeat?.();

    expect(events).toEqual(["connect", "failed", "clear", "disconnect"]);
  });

  it("uses libpq environment variables when no connection URL is provided", () => {
    const original = {
      PGDATABASE: process.env.PGDATABASE,
      PGHOST: process.env.PGHOST,
      PGPASSWORD: process.env.PGPASSWORD,
      PGPORT: process.env.PGPORT,
      PGUSER: process.env.PGUSER,
    };
    process.env.PGHOST = "postgres";
    process.env.PGPORT = "5432";
    process.env.PGUSER = "ledger_app";
    process.env.PGPASSWORD = "reserved:chars@are/fine";
    process.env.PGDATABASE = "ledger";

    try {
      const client = createWorkerClient();

      expect(client.connectionParameters).toMatchObject({
        database: "ledger",
        host: "postgres",
        password: "reserved:chars@are/fine",
        port: 5432,
        user: "ledger_app",
      });
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

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
