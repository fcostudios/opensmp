import { randomBytes as cryptoRandomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CREDENTIAL_ENV_NAMES = [
  "ANTHROPIC_CORPORATIVO_TEAMS_ADMIN_KEY",
  "ANTHROPIC_CORPORATIVO_TEAMS_ANALYTICS_KEY",
  "ANTHROPIC_CENTROHUB_TEAMS_ADMIN_KEY",
  "ANTHROPIC_CENTROHUB_TEAMS_ANALYTICS_KEY",
] as const;

export interface OperatorPaths {
  readonly privateRoot: string;
  readonly runtimeEnvFile: string;
  readonly kekFile: string;
  readonly manifestFile: string;
}

type RandomBytes = (length: number) => Uint8Array;

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertSafePrivateRoot(privateRoot: string): Promise<void> {
  const expected = resolve(privateRoot);
  try {
    const rootStat = await lstat(expected);
    const resolved = await realpath(expected);
    if (
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory() ||
      resolved !== expected
    ) {
      throw new Error("unsafe");
    }
  } catch {
    throw new Error(`Private import directory is unsafe: ${expected}`);
  }
}

async function assertCreatedFileParent(
  path: string,
  privateRoot: string,
): Promise<void> {
  const fileStat = await lstat(path);
  const resolvedParent = await realpath(dirname(path));
  const resolvedFile = await realpath(path);
  if (
    fileStat.isSymbolicLink() ||
    !fileStat.isFile() ||
    resolvedParent !== privateRoot ||
    dirname(resolvedFile) !== privateRoot
  ) {
    throw new Error("unsafe");
  }
}

async function targetExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw new Error(`Unable to inspect private import path: ${path}`);
  }
}

function createDistinctCredentialValues(randomBytes: RandomBytes): string[] {
  const values = new Set<string>();
  while (values.size < CREDENTIAL_ENV_NAMES.length) {
    values.add(
      `synthetic-local-${Buffer.from(randomBytes(24)).toString("base64url")}`,
    );
  }
  return [...values];
}

export async function initializePrivateMaterial(
  paths: OperatorPaths,
  randomBytes: RandomBytes = cryptoRandomBytes,
): Promise<{
  readonly runtimeEnvFile: string;
  readonly kekFile: string;
}> {
  const privateRoot = resolve(paths.privateRoot);
  const runtimeEnvFile = resolve(paths.runtimeEnvFile);
  const kekFile = resolve(paths.kekFile);
  assertCondition(
    dirname(runtimeEnvFile) === privateRoot && dirname(kekFile) === privateRoot,
    `Private import paths must be direct children of: ${privateRoot}`,
  );

  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  await assertSafePrivateRoot(privateRoot);
  await chmod(privateRoot, 0o700);
  assertCondition(
    !(await targetExists(runtimeEnvFile)),
    `Refusing to overwrite existing file: ${runtimeEnvFile}`,
  );
  assertCondition(
    !(await targetExists(kekFile)),
    `Refusing to overwrite existing file: ${kekFile}`,
  );

  const credentialValues = createDistinctCredentialValues(randomBytes);
  const runtimeEnvironment = [
    `LEDGER_CREDENTIAL_MANIFEST_FILE=${resolve(paths.manifestFile)}`,
    `LEDGER_CREDENTIAL_KEK_FILE=${kekFile}`,
    ...CREDENTIAL_ENV_NAMES.map(
      (name, index) => `${name}=${credentialValues[index]}`,
    ),
    "",
  ].join("\n");
  const kek = `${Buffer.from(randomBytes(32)).toString("base64")}\n`;
  let wroteKek = false;
  let wroteRuntimeEnvironment = false;

  try {
    await assertSafePrivateRoot(privateRoot);
    await writeFile(kekFile, kek, { flag: "wx", mode: 0o400 });
    wroteKek = true;
    await assertSafePrivateRoot(privateRoot);
    await writeFile(runtimeEnvFile, runtimeEnvironment, {
      flag: "wx",
      mode: 0o600,
    });
    wroteRuntimeEnvironment = true;
    await assertSafePrivateRoot(privateRoot);
    await assertCreatedFileParent(kekFile, privateRoot);
    await assertCreatedFileParent(runtimeEnvFile, privateRoot);
  } catch {
    const leftovers: string[] = [];
    if (wroteRuntimeEnvironment) {
      try {
        await unlink(runtimeEnvFile);
      } catch {
        leftovers.push(runtimeEnvFile);
      }
    }
    if (wroteKek) {
      try {
        await unlink(kekFile);
      } catch {
        leftovers.push(kekFile);
      }
    }
    if (leftovers.length > 0) {
      throw new Error(`Private import cleanup required: ${leftovers.join(", ")}`);
    }
    throw new Error(`Unable to create private import files under: ${privateRoot}`);
  }

  return { runtimeEnvFile, kekFile };
}
