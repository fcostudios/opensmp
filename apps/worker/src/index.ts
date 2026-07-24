import { Client } from "pg";
import { pathToFileURL } from "node:url";

import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_PATH, touchHeartbeat } from "./health.js";

type Timer = ReturnType<typeof setInterval>;

type WorkerLifecycleDependencies = {
  clearHeartbeat: (timer: Timer) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  onHeartbeatFailure?: (error: unknown) => Promise<void>;
  scheduleHeartbeat: (heartbeat: () => void | Promise<void>, intervalMs: number) => Timer;
  touchHeartbeat: () => Promise<void>;
};

export function createWorkerClient(connectionString = process.env.DATABASE_URL): Client {
  return connectionString ? new Client({ connectionString }) : new Client();
}

export function createWorkerLifecycle(dependencies: WorkerLifecycleDependencies) {
  let timer: Timer | undefined;
  let stopped = false;

  return {
    async start(): Promise<void> {
      await dependencies.connect();
      await dependencies.touchHeartbeat();
      timer = dependencies.scheduleHeartbeat(
        async () => {
          try {
            await dependencies.touchHeartbeat();
          } catch (error) {
            await dependencies.onHeartbeatFailure?.(error);
          }
        },
        HEARTBEAT_INTERVAL_MS,
      );
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (timer) dependencies.clearHeartbeat(timer);
      await dependencies.disconnect();
    },
  };
}

async function main(): Promise<void> {
  const client = createWorkerClient();
  let lifecycle: ReturnType<typeof createWorkerLifecycle>;
  lifecycle = createWorkerLifecycle({
    clearHeartbeat: clearInterval,
    connect: async () => {
      await client.connect();
    },
    disconnect: () => client.end(),
    onHeartbeatFailure: async (error) => {
      console.error(error);
      await lifecycle.stop();
      process.exitCode = 1;
    },
    scheduleHeartbeat: (heartbeat, intervalMs) =>
      setInterval(() => {
        void heartbeat();
      }, intervalMs),
    touchHeartbeat: async () => {
      await client.query("SELECT 1");
      await touchHeartbeat(HEARTBEAT_PATH, new Date());
    },
  });

  await lifecycle.start();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await lifecycle.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
