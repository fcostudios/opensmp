import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// CHG-067 — testcontainers 12.0.4 waits a hardcoded 10 s for Docker to publish a
// new container's ports. When every integration file starts its fixture at once
// (up to 13 in a full gate) Docker Desktop can take longer, and the start fails.
// Container starts therefore share a few cross-process slots; tests do not: a
// slot is held only while one container starts. One slot (the first attempt)
// queued a fixture past its file's own 30 s beforeAll in the opening burst, so
// three starts may run at once.
export const CONTAINER_START_LOCK = join(tmpdir(), "smp-testcontainers-start.lock");
export const CONTAINER_START_SLOTS = 3;

const POLL_MS = 50;
// A slot with no pid file this old lost its holder between mkdir and writeFile.
const PIDLESS_STALE_MS = 10_000;

function holderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function tryTake(slotPath: string): Promise<boolean> {
  try {
    await mkdir(slotPath);
    await writeFile(join(slotPath, "pid"), String(process.pid));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const pid = Number(await readFile(join(slotPath, "pid"), "utf8").catch(() => ""));
  // A holder that died (killed run) never releases; take its slot over. An
  // unreadable pid is a holder between mkdir and writeFile: wait for it. Two
  // waiters that see the same dead holder at once may both get in; that costs
  // one extra concurrent start, never a deadlock.
  const pidless = !(Number.isInteger(pid) && pid > 0);
  const pidlessStale = pidless
    && Date.now() - ((await stat(slotPath).catch(() => null))?.mtimeMs ?? Date.now()) > PIDLESS_STALE_MS;
  if ((!pidless && !holderAlive(pid)) || pidlessStale) {
    await rm(slotPath, { recursive: true, force: true });
    return tryTake(slotPath);
  }
  return false;
}

async function acquire(lockPath: string, slots: number): Promise<string> {
  for (;;) {
    for (let slot = 0; slot < slots; slot += 1) {
      const slotPath = `${lockPath}.${slot}`;
      if (await tryTake(slotPath)) return slotPath;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export async function withContainerStartLock<T>(
  body: () => Promise<T>,
  { lockPath = CONTAINER_START_LOCK, slots = CONTAINER_START_SLOTS }: { lockPath?: string; slots?: number } = {},
): Promise<T> {
  const slotPath = await acquire(lockPath, slots);
  try {
    return await body();
  } finally {
    await rm(slotPath, { recursive: true, force: true });
  }
}
