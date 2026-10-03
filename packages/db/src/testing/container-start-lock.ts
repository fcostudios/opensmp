import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// CHG-067 — testcontainers 12.0.4 waits a hardcoded 10 s for Docker to publish a
// new container's ports. When every integration file starts its fixture at once
// (up to 13 in a full gate) Docker Desktop can take longer, and the start fails.
// Container starts therefore take turns across processes; tests do not: the lock
// is held only while one container starts.
export const CONTAINER_START_LOCK = join(tmpdir(), "smp-testcontainers-start.lock");

const POLL_MS = 50;
// A lock with no pid file this old lost its holder between mkdir and writeFile.
const PIDLESS_STALE_MS = 10_000;

function holderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquire(lockPath: string): Promise<void> {
  for (;;) {
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, "pid"), String(process.pid));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const pid = Number(await readFile(join(lockPath, "pid"), "utf8").catch(() => ""));
    // A holder that died (killed run) never releases; take its lock over. An
    // unreadable pid is a holder between mkdir and writeFile: wait for it. Two
    // waiters that see the same dead holder at once may both get in; that costs
    // one concurrent start (the behaviour before this lock), never a deadlock.
    const pidless = !(Number.isInteger(pid) && pid > 0);
    const pidlessStale = pidless
      && Date.now() - ((await stat(lockPath).catch(() => null))?.mtimeMs ?? Date.now()) > PIDLESS_STALE_MS;
    if ((!pidless && !holderAlive(pid)) || pidlessStale) {
      await rm(lockPath, { recursive: true, force: true });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export async function withContainerStartLock<T>(
  body: () => Promise<T>,
  lockPath: string = CONTAINER_START_LOCK,
): Promise<T> {
  await acquire(lockPath);
  try {
    return await body();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
