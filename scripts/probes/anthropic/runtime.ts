import {
  chmod,
  lstat,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import type { Stats } from "node:fs";
import {
  basename,
  dirname,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";

export interface SecureWriterDependencies {
  chmod: (path: string, mode: number) => Promise<void>;
  lstat: (path: string) => Promise<Pick<Stats, "isSymbolicLink">>;
  open: (
    path: string,
    flags: "r" | "wx",
    mode?: number,
  ) => Promise<FileHandle>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  randomId: () => string;
  processId: number;
}

export type SecureJsonWriter = (
  outputPath: string,
  artifact: Record<string, unknown>,
) => Promise<void>;

const nodeDependencies: SecureWriterDependencies = {
  chmod: (path, mode) => chmod(path, mode),
  lstat: (path) => lstat(path),
  open: (path, flags, mode) => open(path, flags, mode),
  rename: (from, to) => rename(from, to),
  unlink: (path) => unlink(path),
  randomId: randomUUID,
  processId: process.pid,
};

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function rejectSymlinkComponents(
  outputPath: string,
  dependencies: SecureWriterDependencies,
): Promise<string> {
  const absolutePath = resolve(outputPath);
  const root = parse(absolutePath).root;
  const components = relative(root, absolutePath).split(sep);
  let current = root;
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    try {
      if ((await dependencies.lstat(current)).isSymbolicLink()) {
        throw new Error(
          "secure output path must not contain a symbolic link",
        );
      }
    } catch (error: unknown) {
      const isFinalComponent = index === components.length - 1;
      if (isFinalComponent && isMissingPath(error)) return absolutePath;
      throw error;
    }
  }
  return absolutePath;
}

async function syncDirectory(
  path: string,
  dependencies: SecureWriterDependencies,
): Promise<void> {
  let directory: FileHandle | null = null;
  try {
    directory = await dependencies.open(path, "r");
    await directory.sync();
  } finally {
    await directory?.close();
  }
}

/**
 * Atomically replace a JSON artifact without ever exposing the new content
 * under permissive permissions.
 */
export function createAtomicWriteSecureJson(
  dependencies: SecureWriterDependencies,
): SecureJsonWriter {
  return async (
    outputPath: string,
    artifact: Record<string, unknown>,
  ): Promise<void> => {
    const safeOutputPath = await rejectSymlinkComponents(
      outputPath,
      dependencies,
    );
    const directory = dirname(safeOutputPath);
    const temporaryPath = join(
      directory,
      `.${basename(safeOutputPath)}.${dependencies.processId}.${dependencies.randomId()}.tmp`,
    );
    let temporary: FileHandle | null = null;
    try {
      temporary = await dependencies.open(temporaryPath, "wx", 0o600);
      await temporary.writeFile(
        `${JSON.stringify(artifact, null, 2)}\n`,
        "utf8",
      );
      await temporary.sync();
      await temporary.close();
      temporary = null;
      await dependencies.chmod(temporaryPath, 0o600);
      await rejectSymlinkComponents(safeOutputPath, dependencies);
      await dependencies.rename(temporaryPath, safeOutputPath);
      await dependencies.chmod(safeOutputPath, 0o600);
      await syncDirectory(directory, dependencies);
    } catch (error) {
      await temporary?.close().catch(() => undefined);
      await dependencies.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  };
}

export const atomicWriteSecureJson =
  createAtomicWriteSecureJson(nodeDependencies);
