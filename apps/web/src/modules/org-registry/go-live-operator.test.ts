import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  initializePrivateMaterial,
  parseOperatorMode,
  type OperatorPaths,
} from "./go-live-operator";

const directories: string[] = [];
const usage =
  "Usage: pnpm --filter smp-web import:go-live <init|preview|apply|verify>";

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return realpath(directory);
}

function paths(privateRoot: string): OperatorPaths {
  return {
    privateRoot,
    runtimeEnvFile: join(privateRoot, "us007.runtime.env"),
    kekFile: join(privateRoot, "us007.integration-credential.kek"),
    manifestFile: join(privateRoot, "credential-manifest.json"),
  };
}

function deterministicRandomBytes() {
  let call = 0;
  return (length: number): Uint8Array => {
    call += 1;
    return Uint8Array.from({ length }, (_, index) => (call + index) % 256);
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe("US-007 local operator private material", () => {
  it("creates a locked-down directory, runtime environment, and KEK", async () => {
    const parent = await temporaryDirectory("ledger-operator-init-");
    const operatorPaths = paths(join(parent, "private"));

    const created = await initializePrivateMaterial(
      operatorPaths,
      deterministicRandomBytes(),
    );

    expect(created).toEqual({
      runtimeEnvFile: operatorPaths.runtimeEnvFile,
      kekFile: operatorPaths.kekFile,
    });
    expect((await stat(operatorPaths.privateRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(operatorPaths.runtimeEnvFile)).mode & 0o777).toBe(0o600);
    expect((await stat(operatorPaths.kekFile)).mode & 0o777).toBe(0o400);
    const runtime = await readFile(operatorPaths.runtimeEnvFile, "utf8");
    const credentialValues = runtime
      .split("\n")
      .filter((line) => line.startsWith("ANTHROPIC_"))
      .map((line) => line.slice(line.indexOf("=") + 1));
    expect(credentialValues).toHaveLength(4);
    expect(new Set(credentialValues).size).toBe(4);
    expect(credentialValues.every((value) =>
      value.startsWith("synthetic-local-"))).toBe(true);
    expect(
      Buffer.from((await readFile(operatorPaths.kekFile, "utf8")).trim(), "base64"),
    ).toHaveLength(32);
  });

  it("refuses a second initialization without changing either file", async () => {
    const parent = await temporaryDirectory("ledger-operator-repeat-");
    const operatorPaths = paths(join(parent, "private"));
    await initializePrivateMaterial(operatorPaths, deterministicRandomBytes());
    const before = {
      runtime: await readFile(operatorPaths.runtimeEnvFile),
      kek: await readFile(operatorPaths.kekFile),
    };

    await expect(initializePrivateMaterial(
      operatorPaths,
      deterministicRandomBytes(),
    )).rejects.toThrow(`Refusing to overwrite existing file: ${operatorPaths.runtimeEnvFile}`);

    expect(await readFile(operatorPaths.runtimeEnvFile)).toEqual(before.runtime);
    expect(await readFile(operatorPaths.kekFile)).toEqual(before.kek);
  });

  it("rejects a symlinked private root without creating files in its target", async () => {
    const parent = await temporaryDirectory("ledger-operator-symlink-");
    const outside = await temporaryDirectory("ledger-operator-outside-");
    const privateRoot = join(parent, "private");
    await symlink(outside, privateRoot, "dir");

    await expect(initializePrivateMaterial(
      paths(privateRoot),
      deterministicRandomBytes(),
    )).rejects.toThrow(`Private import directory is unsafe: ${privateRoot}`);

    expect((await lstat(privateRoot)).isSymbolicLink()).toBe(true);
    expect(await readdir(outside)).toEqual([]);
  });

  it("reports a safely cleaned partial initialization without secret material", async () => {
    const parent = await temporaryDirectory("ledger-operator-cleanup-");
    const privateRoot = join(parent, "private");
    const sharedFile = join(privateRoot, "shared");
    const operatorPaths: OperatorPaths = {
      privateRoot,
      runtimeEnvFile: sharedFile,
      kekFile: sharedFile,
      manifestFile: join(parent, "manifest.json"),
    };

    await expect(initializePrivateMaterial(
      operatorPaths,
      deterministicRandomBytes(),
    )).rejects.toThrow(`Unable to create private import files under: ${privateRoot}`);

    await expect(lstat(sharedFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("US-007 local operator arguments", () => {
  it.each(["init", "preview", "apply", "verify"] as const)(
    "accepts the exact %s mode",
    (mode) => {
      expect(parseOperatorMode([mode])).toBe(mode);
    },
  );

  it.each([
    { args: [] },
    { args: ["unknown"] },
    { args: ["apply", "--force"] },
    { args: ["init", "unexpected"] },
  ])("rejects invalid argument vector $args with exact usage", ({ args }) => {
    expect(() => parseOperatorMode(args)).toThrowError(new Error(usage));
  });
});
