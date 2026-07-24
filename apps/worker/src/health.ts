import { rename, rm, utimes, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const HEARTBEAT_PATH = "/tmp/ledger-worker-heartbeat";
export const HEARTBEAT_INTERVAL_MS = 60_000;

export async function touchHeartbeat(path: string, now: Date): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, "", { flag: "wx" });
    await utimes(temporaryPath, now, now);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function isHeartbeatFresh(
  modifiedAtMs: number,
  nowMs: number,
  maxAgeMs = HEARTBEAT_INTERVAL_MS,
): boolean {
  return modifiedAtMs <= nowMs && nowMs - modifiedAtMs <= maxAgeMs;
}
