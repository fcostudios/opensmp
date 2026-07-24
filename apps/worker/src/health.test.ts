import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HEARTBEAT_INTERVAL_MS, isHeartbeatFresh, touchHeartbeat } from "./health";

const workDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(workDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("worker heartbeat", () => {
  it("atomically creates or refreshes the heartbeat at the supplied clock time", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ledger-worker-"));
    workDirectories.push(directory);
    const heartbeatPath = join(directory, "heartbeat");
    const now = new Date("2026-07-24T12:00:00.000Z");

    await touchHeartbeat(heartbeatPath, now);

    expect((await stat(heartbeatPath)).mtime.getTime()).toBe(now.getTime());
  });

  it("accepts only a heartbeat within the bounded worker interval", () => {
    const now = 1_000_000;

    expect(HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(60_000);
    expect(isHeartbeatFresh(now - HEARTBEAT_INTERVAL_MS, now)).toBe(true);
    expect(isHeartbeatFresh(now - HEARTBEAT_INTERVAL_MS - 1, now)).toBe(false);
  });
});
