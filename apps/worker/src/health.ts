import { open } from "node:fs/promises";

export const HEARTBEAT_PATH = "/tmp/ledger-worker-heartbeat";
export const HEARTBEAT_INTERVAL_MS = 60_000;

export async function touchHeartbeat(path: string, now: Date): Promise<void> {
  const file = await open(path, "a");
  try {
    await file.utimes(now, now);
  } finally {
    await file.close();
  }
}

export function isHeartbeatFresh(
  modifiedAtMs: number,
  nowMs: number,
  maxAgeMs = HEARTBEAT_INTERVAL_MS,
): boolean {
  return modifiedAtMs <= nowMs && nowMs - modifiedAtMs <= maxAgeMs;
}
