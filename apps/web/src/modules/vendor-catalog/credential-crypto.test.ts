import { execFile } from "node:child_process";
import { fstat as fstatCallback } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import type { CredentialEnvelopeV1 } from "@smp/domain";

import {
  decryptCredential,
  encryptCredential,
  readKekFile,
} from "./credential-crypto";

const kek = Uint8Array.from({ length: 32 }, (_, index) => index);
const deterministicBytes = (length: number) =>
  Uint8Array.from({ length }, (_, index) => (index * 7 + length) % 256);
const fstat = promisify(fstatCallback);
const execFileAsync = promisify(execFile);

async function countDescriptorsFor(path: string): Promise<number> {
  const target = await stat(path);
  const openDescriptors = await Promise.all(
    Array.from({ length: 256 }, (_, descriptor) =>
      fstat(descriptor).catch(() => undefined),
    ),
  );
  return openDescriptors.filter(
    (descriptor) =>
      descriptor !== undefined &&
      descriptor.dev === target.dev &&
      descriptor.ino === target.ino,
  ).length;
}

describe("credential envelope encryption", () => {
  it("encrypts deterministically under injected test randomness and decrypts exactly", async () => {
    const first = await encryptCredential("sk-ant-sensitive", kek, deterministicBytes);
    const second = await encryptCredential("sk-ant-sensitive", kek, deterministicBytes);
    expect(first).toEqual(second);
    expect(first).toEqual({
      version: 1,
      algorithm: "xchacha20poly1305",
      wrappedDek:
        "GB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5.Mq3HLkXD1RqzfnnjJtgnWxwFZWZ6jL2urlTLjt6jgZWCgt0KjiOaMvNXoalVmN1J",
      nonce: "GB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5",
      ciphertext: "VfA1qyCVmJBODfPQZq/W+JXxkuroV54pdczlPooYDQQ=",
    });
    expect(JSON.stringify(first)).not.toContain("sk-ant-sensitive");
    expect(await decryptCredential(first, kek)).toBe("sk-ant-sensitive");
  });

  it("authenticates ciphertext and the wrapping key", async () => {
    const envelope = await encryptCredential("credential", kek, deterministicBytes);
    const tampered = {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -2)}AA`,
    };
    await expect(decryptCredential(tampered, kek)).rejects.toThrow();
    await expect(
      decryptCredential(envelope, Uint8Array.from(kek, (byte) => byte ^ 1)),
    ).rejects.toThrow();
  });

  it("accepts a base64 KEK only from the supplied secret file path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ledger-kek-"));
    const validPath = join(directory, "valid");
    const invalidPath = join(directory, "invalid");
    try {
      await writeFile(validPath, `${Buffer.from(kek).toString("base64")}\n`, "utf8");
      await writeFile(
        invalidPath,
        Buffer.from(kek.slice(0, 31)).toString("base64"),
        "utf8",
      );
      await chmod(validPath, 0o400);
      await chmod(invalidPath, 0o440);
      expect(await readKekFile(validPath, { allowedRoot: directory })).toEqual(kek);
      await expect(
        readKekFile(invalidPath, { allowedRoot: directory }),
      ).rejects.toThrow(/32 bytes/i);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("defaults to the production secret root instead of the process directory", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".ledger-kek-default-policy-"));
    const validPath = join(directory, "valid");
    try {
      await writeFile(validPath, `${Buffer.from(kek).toString("base64")}\n`, "utf8");
      await chmod(validPath, 0o400);
      const error = await readKekFile(validPath).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as NodeJS.ErrnoException).code).toBe(
        "KEK_FILE_UNREADABLE",
      );
      expect(String(error)).not.toContain(validPath);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects a mode-0400 non-regular object with a specific safe error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ledger-kek-type-"));
    const nonRegularPath = join(directory, "directory");
    const fifoPath = join(directory, "fifo");
    try {
      await mkdir(nonRegularPath);
      await chmod(nonRegularPath, 0o400);
      await execFileAsync("mkfifo", [fifoPath]);
      await chmod(fifoPath, 0o400);
      for (const candidate of [nonRegularPath, fifoPath]) {
        const error = await readKekFile(candidate, {
          allowedRoot: directory,
        }).then(
          () => undefined,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as NodeJS.ErrnoException).code).toBe(
          "KEK_NOT_REGULAR_FILE",
        );
        expect(String(error)).not.toContain(candidate);
      }
    } finally {
      await chmod(nonRegularPath, 0o700).catch(() => undefined);
      await rm(directory, { recursive: true });
    }
  });

  it("closes the real file descriptor after every KEK read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ledger-kek-fd-"));
    const validPath = join(directory, "valid");
    try {
      await writeFile(validPath, `${Buffer.from(kek).toString("base64")}\n`, "utf8");
      await chmod(validPath, 0o400);
      const before = await countDescriptorsFor(validPath);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        expect(await readKekFile(validPath, { allowedRoot: directory })).toEqual(kek);
      }
      expect(await countDescriptorsFor(validPath)).toBe(before);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects paths outside the allowed root, symlinks, non-files, and permissive modes without path disclosure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ledger-kek-policy-"));
    const outsideDirectory = await mkdtemp(join(tmpdir(), "ledger-kek-outside-"));
    const validPath = join(directory, "valid");
    const symlinkPath = join(directory, "linked");
    const directoryPath = join(directory, "not-a-file");
    const permissivePath = join(directory, "permissive");
    const nestedDirectory = join(directory, "nested");
    const nestedKekPath = join(nestedDirectory, "kek");
    const linkedDirectory = join(directory, "linked-directory");
    const blockingPath = join(directory, "blocking");
    const outsidePath = join(outsideDirectory, "outside");
    const nonDirectoryRoot = join(outsideDirectory, "root-file");
    const linkedRoot = `${directory}-linked-root`;
    const encoded = `${Buffer.from(kek).toString("base64")}\n`;
    try {
      await writeFile(validPath, encoded, "utf8");
      await chmod(validPath, 0o400);
      await symlink(validPath, symlinkPath);
      await mkdir(directoryPath);
      await writeFile(permissivePath, encoded, "utf8");
      await chmod(permissivePath, 0o644);
      await writeFile(outsidePath, encoded, "utf8");
      await chmod(outsidePath, 0o400);
      await writeFile(nonDirectoryRoot, encoded, "utf8");
      await chmod(nonDirectoryRoot, 0o400);
      await mkdir(nestedDirectory);
      await writeFile(nestedKekPath, encoded, "utf8");
      await chmod(nestedKekPath, 0o400);
      await symlink(nestedDirectory, linkedDirectory);
      await writeFile(blockingPath, encoded, "utf8");
      await chmod(blockingPath, 0o400);
      await symlink(directory, linkedRoot);

      expect(await readKekFile(nestedKekPath, {
        allowedRoot: directory,
      })).toEqual(kek);
      for (const { candidate, code } of [
        { candidate: directory, code: "KEK_FILE_UNREADABLE" },
        { candidate: join(directory, ".."), code: "KEK_FILE_UNREADABLE" },
        { candidate: symlinkPath, code: "KEK_FILE_UNREADABLE" },
        { candidate: directoryPath, code: "KEK_NOT_REGULAR_FILE" },
        { candidate: permissivePath, code: "KEK_FILE_UNREADABLE" },
        { candidate: join(linkedDirectory, "kek"), code: "KEK_FILE_UNREADABLE" },
        { candidate: join(blockingPath, "kek"), code: "KEK_FILE_UNREADABLE" },
        { candidate: outsidePath, code: "KEK_FILE_UNREADABLE" },
        { candidate: join(directory, "missing"), code: "KEK_FILE_UNREADABLE" },
      ]) {
        const error = await readKekFile(candidate, {
          allowedRoot: directory,
        }).then(
          () => undefined,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as NodeJS.ErrnoException).code).toBe(code);
        expect(String(error)).toContain("Unable to read KEK secret file");
        expect(String(error)).not.toContain(candidate);
      }
      const linkedRootError = await readKekFile(join(linkedRoot, "valid"), {
        allowedRoot: linkedRoot,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(linkedRootError).toBeInstanceOf(Error);
      expect((linkedRootError as NodeJS.ErrnoException).code).toBe(
        "KEK_FILE_UNREADABLE",
      );
      expect(String(linkedRootError)).not.toContain(linkedRoot);
      const nonDirectoryRootError = await readKekFile(
        join(nonDirectoryRoot, "kek"),
        { allowedRoot: nonDirectoryRoot },
      ).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(nonDirectoryRootError).toBeInstanceOf(Error);
      expect((nonDirectoryRootError as NodeJS.ErrnoException).code).toBe(
        "KEK_FILE_UNREADABLE",
      );
      expect(String(nonDirectoryRootError)).not.toContain(nonDirectoryRoot);
    } finally {
      await rm(linkedRoot, { force: true });
      await rm(directory, { recursive: true });
      await rm(outsideDirectory, { recursive: true });
    }
  });

  it("rejects invalid key sizes and envelope metadata before decryption", async () => {
    const envelope = await encryptCredential("credential", kek, deterministicBytes);
    const shortKek = kek.slice(0, 31);
    await expect(
      encryptCredential("credential", shortKek, deterministicBytes),
    ).rejects.toThrow(/32 bytes/i);
    await expect(decryptCredential(envelope, shortKek)).rejects.toThrow(/32 bytes/i);
    await expect(decryptCredential(
      { ...envelope, version: 2 } as unknown as CredentialEnvelopeV1,
      kek,
    )).rejects.toThrow(/unsupported/i);
    await expect(decryptCredential(
      { ...envelope, algorithm: "aes" } as unknown as CredentialEnvelopeV1,
      kek,
    )).rejects.toThrow(/unsupported/i);
  });

  it.each(["", "only-one-part", ".cipher", "nonce.", "nonce.cipher.extra"])(
    "rejects malformed wrapped DEK %j",
    async (wrappedDek) => {
      const envelope = await encryptCredential("credential", kek, deterministicBytes);
      await expect(
        decryptCredential({ ...envelope, wrappedDek }, kek),
      ).rejects.toThrow(/wrapped DEK/i);
    },
  );
});
