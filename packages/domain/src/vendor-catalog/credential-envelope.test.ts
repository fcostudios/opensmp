import { describe, expect, it } from "vitest";

import {
  parseCredentialEnvelope,
  serializeCredentialEnvelope,
} from "./credential-envelope";

describe("credential envelope contract", () => {
  it("round-trips only the versioned XChaCha20-Poly1305 shape", () => {
    const envelope = {
      version: 1 as const,
      algorithm: "xchacha20poly1305" as const,
      wrappedDek: "wrap",
      nonce: "nonce",
      ciphertext: "cipher",
    };
    expect(parseCredentialEnvelope(serializeCredentialEnvelope(envelope))).toEqual(envelope);
  });

  it("rejects unknown versions, algorithms, and extra fields", () => {
    expect(() =>
      parseCredentialEnvelope('{"version":2,"algorithm":"xchacha20poly1305","wrappedDek":"a","nonce":"b","ciphertext":"c"}'),
    ).toThrow(/envelope/i);
    expect(() =>
      parseCredentialEnvelope('{"version":1,"algorithm":"aes","wrappedDek":"a","nonce":"b","ciphertext":"c"}'),
    ).toThrow(/envelope/i);
    expect(() =>
      parseCredentialEnvelope('{"version":1,"algorithm":"xchacha20poly1305","wrappedDek":"a","nonce":"b","ciphertext":"c","secret":"leak"}'),
    ).toThrow(/envelope/i);
  });

  it.each([
    "not-json",
    "null",
    '"string"',
    "[]",
    '{"version":1,"algorithm":"xchacha20poly1305","wrappedDek":1,"nonce":"b","ciphertext":"c"}',
    '{"version":1,"algorithm":"xchacha20poly1305","wrappedDek":"","nonce":"b","ciphertext":"c"}',
    '{"version":1,"algorithm":"xchacha20poly1305","wrappedDek":"a","nonce":1,"ciphertext":"c"}',
    '{"version":1,"algorithm":"xchacha20poly1305","wrappedDek":"a","nonce":"","ciphertext":"c"}',
    '{"version":1,"algorithm":"xchacha20poly1305","wrappedDek":"a","nonce":"b","ciphertext":1}',
    '{"version":1,"algorithm":"xchacha20poly1305","wrappedDek":"a","nonce":"b","ciphertext":""}',
  ])("rejects malformed envelope %s", (value) => {
    expect(() => parseCredentialEnvelope(value)).toThrow(/envelope/i);
  });
});
