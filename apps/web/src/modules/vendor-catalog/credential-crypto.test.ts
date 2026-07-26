import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    const outsidePath = join(outsideDirectory, "outside");
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
      await mkdir(nestedDirectory);
      await writeFile(nestedKekPath, encoded, "utf8");
      await chmod(nestedKekPath, 0o400);
      await symlink(nestedDirectory, linkedDirectory);
      await symlink(directory, linkedRoot);

      expect(await readKekFile(nestedKekPath, {
        allowedRoot: directory,
      })).toEqual(kek);
      for (const candidate of [
        directory,
        join(directory, ".."),
        symlinkPath,
        directoryPath,
        permissivePath,
        join(linkedDirectory, "kek"),
        outsidePath,
      ]) {
        const error = await readKekFile(candidate, {
          allowedRoot: directory,
        }).then(
          () => undefined,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).toContain("Unable to read KEK secret file");
        expect(String(error)).not.toContain(candidate);
      }
      await expect(readKekFile(join(linkedRoot, "valid"), {
        allowedRoot: linkedRoot,
      })).rejects.toThrow("Unable to read KEK secret file");
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
