import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ComposeEnvironmentLockOwner {
  readonly version: 1;
  readonly ownerId: string;
  readonly pid: number;
  readonly acquiredAt: string;
  readonly cwd: string;
}

export interface ComposeEnvironmentLock {
  readonly owner: ComposeEnvironmentLockOwner;
  release(): Promise<void>;
}

const defaultLockDirectory = join(
  tmpdir(),
  "ledger-us004-e2e-compose-environment.lock",
);
const ownerFileName = "owner.json";

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}

function parseOwner(serialized: string): ComposeEnvironmentLockOwner {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Compose environment lock ownership is unreadable");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("ownerId" in value) ||
    typeof value.ownerId !== "string" ||
    !value.ownerId ||
    !("pid" in value) ||
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) <= 0 ||
    !("acquiredAt" in value) ||
    typeof value.acquiredAt !== "string" ||
    Number.isNaN(Date.parse(value.acquiredAt)) ||
    !("cwd" in value) ||
    typeof value.cwd !== "string"
  ) {
    throw new Error("Compose environment lock ownership is invalid");
  }
  return value as ComposeEnvironmentLockOwner;
}

function processIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    if (errorCode(error) === "EPERM") return true;
    throw error;
  }
}

export async function acquireComposeEnvironmentLock({
  directory = defaultLockDirectory,
}: {
  readonly directory?: string;
} = {}): Promise<ComposeEnvironmentLock> {
  const ownerFile = join(directory, ownerFileName);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(directory);
      const owner: ComposeEnvironmentLockOwner = {
        version: 1,
        ownerId: randomUUID(),
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        cwd: process.cwd(),
      };
      try {
        await writeFile(ownerFile, JSON.stringify(owner), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        await rmdir(directory).catch(() => undefined);
        throw error;
      }

      let released = false;
      return {
        owner,
        async release() {
          if (released) {
            throw new Error("Compose environment lock was already released");
          }
          const recorded = parseOwner(await readFile(ownerFile, "utf8"));
          if (recorded.ownerId !== owner.ownerId) {
            throw new Error("Compose environment lock ownership changed");
          }
          await unlink(ownerFile);
          await rmdir(directory);
          released = true;
        },
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    let recorded: ComposeEnvironmentLockOwner;
    try {
      recorded = parseOwner(await readFile(ownerFile, "utf8"));
    } catch (error) {
      throw new Error(
        "Compose environment lock exists without demonstrably stale ownership",
        { cause: error },
      );
    }
    if (processIsLive(recorded.pid)) {
      throw new Error(
        `Compose environment is owned by live process ${recorded.pid} ` +
          `from ${recorded.cwd} since ${recorded.acquiredAt}`,
      );
    }
    try {
      await unlink(ownerFile);
      await rmdir(directory);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  throw new Error("Compose environment lock acquisition did not converge");
}

export async function runInitialOwnedCleanup(
  environmentLock: ComposeEnvironmentLock,
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (cleanupError) {
    try {
      await environmentLock.release();
    } catch (releaseError) {
      throw new AggregateError(
        [cleanupError, releaseError],
        "Initial Compose cleanup failed and lock release also failed",
      );
    }
    throw cleanupError;
  }
}
