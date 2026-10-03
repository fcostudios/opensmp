import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

import { CONTAINER_START_SLOTS, withContainerStartLock } from "./container-start-lock";

let directory: string;
let lockPath: string;
let slotPath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "chg067-lock-"));
  lockPath = join(directory, "start.lock");
  slotPath = `${lockPath}.0`;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("one slot: concurrent holders never overlap and every one runs", async () => {
  let inside = 0;
  let maxInside = 0;
  const order: number[] = [];
  await Promise.all(Array.from({ length: 8 }, (_, index) => withContainerStartLock(async () => {
    inside += 1;
    maxInside = Math.max(maxInside, inside);
    await pause(15);
    order.push(index);
    inside -= 1;
  }, { lockPath, slots: 1 })));
  expect(maxInside).toBe(1);
  expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  await expect(stat(slotPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("returns the body's value and releases the lock when the body throws", async () => {
  await expect(withContainerStartLock(async () => 42, { lockPath, slots: 1 })).resolves.toBe(42);
  await expect(withContainerStartLock(async () => { throw new Error("start failed"); }, { lockPath, slots: 1 }))
    .rejects.toThrow("start failed");
  await expect(stat(slotPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("takes over the lock of a holder that died", async () => {
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  await mkdir(slotPath);
  await writeFile(join(slotPath, "pid"), dead.stdout);
  await expect(withContainerStartLock(async () => "acquired", { lockPath, slots: 1 })).resolves.toBe("acquired");
});

test("waits for a live holder in another process", async () => {
  const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    await mkdir(slotPath);
    await writeFile(join(slotPath, "pid"), String(holder.pid));
    let acquired = false;
    const waiting = withContainerStartLock(async () => { acquired = true; }, { lockPath, slots: 1 });
    await pause(300);
    expect(acquired).toBe(false);
    await rm(slotPath, { recursive: true, force: true });
    await waiting;
    expect(acquired).toBe(true);
  } finally {
    holder.kill("SIGKILL");
  }
});

test("a fresh lock without a pid is waited for; a stale one is taken over", async () => {
  await mkdir(slotPath);
  let acquired = false;
  const waiting = withContainerStartLock(async () => { acquired = true; }, { lockPath, slots: 1 });
  await pause(300);
  expect(acquired).toBe(false);
  const old = new Date(Date.now() - 60_000);
  await utimes(slotPath, old, old);
  await waiting;
  expect(acquired).toBe(true);
});

test("the default three slots let at most three starts run at once, and three do", async () => {
  expect(CONTAINER_START_SLOTS).toBe(3);
  let inside = 0;
  let maxInside = 0;
  await Promise.all(Array.from({ length: 9 }, () => withContainerStartLock(async () => {
    inside += 1;
    maxInside = Math.max(maxInside, inside);
    await pause(40);
    inside -= 1;
  }, { lockPath })));
  expect(maxInside).toBe(3);
  for (const slot of [0, 1, 2]) await expect(stat(`${lockPath}.${slot}`)).rejects.toMatchObject({ code: "ENOENT" });
});
