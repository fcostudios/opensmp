import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { CredentialEnvelopeV1 } from "@smp/domain";
import sodium from "libsodium-wrappers";

const AAD = "ledger-credential-envelope-v1";
const WRAPPED_SEPARATOR = ".";

type RandomBytes = (length: number) => Uint8Array;

function requireKek(kek: Uint8Array): void {
  if (kek.length !== 32) {
    throw new Error("Credential KEK must contain exactly 32 bytes");
  }
}

export async function readKekFile(
  path: string,
  {
    allowedRoot = "/run/ledger-secrets",
  }: {
    readonly allowedRoot?: string;
  } = {},
): Promise<Uint8Array> {
  let encoded: string;
  try {
    const root = resolve(allowedRoot);
    const candidate = resolve(path);
    if (!candidate.startsWith(`${root}${sep}`)) throw new Error();

    const rootStat = await lstat(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error();
    }
    let cursor = root;
    const segments = candidate.slice(root.length + 1).split(sep);
    for (const segment of segments.slice(0, -1)) {
      cursor = join(cursor, segment);
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error();
    }
    const candidateStat = await lstat(candidate);
    if (candidateStat.isSymbolicLink()) throw new Error();

    const handle = await open(
      candidate,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile()) throw new Error();
      const mode = openedStat.mode & 0o777;
      if (mode !== 0o400 && mode !== 0o440) throw new Error();
      encoded = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    throw new Error("Unable to read KEK secret file");
  }
  const decoded = Buffer.from(encoded, "base64");
  requireKek(decoded);
  return Uint8Array.from(decoded);
}

export async function encryptCredential(
  plaintext: string,
  kek: Uint8Array,
  randomBytes?: RandomBytes,
): Promise<CredentialEnvelopeV1> {
  await sodium.ready;
  requireKek(kek);
  const random = randomBytes ?? ((length: number) => sodium.randombytes_buf(length));
  const dek = random(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  const nonce = random(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const wrappingNonce = random(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const aad = sodium.from_string(AAD);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    sodium.from_string(plaintext),
    aad,
    null,
    nonce,
    dek,
  );
  const wrappedDek = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    dek,
    aad,
    null,
    wrappingNonce,
    kek,
  );
  const base64 = sodium.base64_variants.ORIGINAL;
  return {
    version: 1,
    algorithm: "xchacha20poly1305",
    wrappedDek: `${sodium.to_base64(wrappingNonce, base64)}${WRAPPED_SEPARATOR}${sodium.to_base64(wrappedDek, base64)}`,
    nonce: sodium.to_base64(nonce, base64),
    ciphertext: sodium.to_base64(ciphertext, base64),
  };
}

export async function decryptCredential(
  envelope: CredentialEnvelopeV1,
  kek: Uint8Array,
): Promise<string> {
  await sodium.ready;
  requireKek(kek);
  if (envelope.version !== 1 || envelope.algorithm !== "xchacha20poly1305") {
    throw new Error("Unsupported credential envelope");
  }
  const [wrappingNonceEncoded, wrappedDekEncoded, ...extra] =
    envelope.wrappedDek.split(WRAPPED_SEPARATOR);
  if (!wrappingNonceEncoded || !wrappedDekEncoded || extra.length > 0) {
    throw new Error("Invalid wrapped DEK");
  }
  const base64 = sodium.base64_variants.ORIGINAL;
  const aad = sodium.from_string(AAD);
  const dek = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sodium.from_base64(wrappedDekEncoded, base64),
    aad,
    sodium.from_base64(wrappingNonceEncoded, base64),
    kek,
  );
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sodium.from_base64(envelope.ciphertext, base64),
    aad,
    sodium.from_base64(envelope.nonce, base64),
    dek,
  );
  return sodium.to_string(plaintext);
}
