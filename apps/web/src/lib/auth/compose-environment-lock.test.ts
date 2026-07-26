import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import {
  acquireComposeEnvironmentLock,
  runInitialOwnedCleanup,
} from "./compose-environment-lock";

const temporaryRoots: string[] = [];

async function lockPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ledger-compose-lock-test-"));
  temporaryRoots.push(root);
  return join(root, "environment.lock");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

test("atomically rejects a second owner while the first process is live", async () => {
  const directory = await lockPath();
  const first = await acquireComposeEnvironmentLock({ directory });

  await expect(
    acquireComposeEnvironmentLock({ directory }),
  ).rejects.toThrow(`live process ${process.pid}`);

  await first.release();
  const replacement = await acquireComposeEnvironmentLock({ directory });
  await replacement.release();
});

test("recovers a lock only after its recorded owner process demonstrably exited", async () => {
  const directory = await lockPath();
  const exited = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  expect(exited.status).toBe(0);
  expect(exited.pid).toBeTypeOf("number");
  await mkdir(directory);
  await writeFile(
    join(directory, "owner.json"),
    JSON.stringify({
      version: 1,
      ownerId: "stale-owner",
      pid: exited.pid,
      acquiredAt: "2026-07-25T00:00:00.000Z",
      cwd: "/stale/worktree",
    }),
  );

  const recovered = await acquireComposeEnvironmentLock({ directory });
  expect(recovered.owner.pid).toBe(process.pid);
  expect(recovered.owner.ownerId).not.toBe("stale-owner");
  await recovered.release();
});

test("propagates release failures instead of claiming cleanup succeeded", async () => {
  const directory = await lockPath();
  const lock = await acquireComposeEnvironmentLock({ directory });
  await writeFile(join(directory, "foreign-owner-data"), "must-not-delete");

  await expect(lock.release()).rejects.toThrow();
});

test("releases the lock without retrying when initial cleanup fails", async () => {
  const directory = await lockPath();
  const lock = await acquireComposeEnvironmentLock({ directory });
  const cleanupError = new Error("initial cleanup failed");
  let cleanupAttempts = 0;

  await expect(
    runInitialOwnedCleanup(lock, async () => {
      cleanupAttempts += 1;
      throw cleanupError;
    }),
  ).rejects.toBe(cleanupError);

  expect(cleanupAttempts).toBe(1);
  const replacement = await acquireComposeEnvironmentLock({ directory });
  await replacement.release();
});
