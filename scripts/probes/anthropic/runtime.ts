import {
  chmod,
  lstat,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error("secure output target must not be a symbolic link");
    }
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  let directory: FileHandle | null = null;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } finally {
    await directory?.close();
  }
}

/**
 * Atomically replace a JSON artifact without ever exposing the new content
 * under permissive permissions.
 */
export async function atomicWriteSecureJson(
  outputPath: string,
  artifact: Record<string, unknown>,
): Promise<void> {
  await rejectSymlink(outputPath);
  const directory = dirname(outputPath);
  const temporaryPath = join(
    directory,
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let temporary: FileHandle | null = null;
  try {
    temporary = await open(temporaryPath, "wx", 0o600);
    await temporary.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await temporary.sync();
    await temporary.close();
    temporary = null;
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await temporary?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
