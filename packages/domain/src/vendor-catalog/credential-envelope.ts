export interface CredentialEnvelopeV1 {
  readonly version: 1;
  readonly algorithm: "xchacha20poly1305";
  readonly wrappedDek: string;
  readonly nonce: string;
  readonly ciphertext: string;
}

const keys = ["algorithm", "ciphertext", "nonce", "version", "wrappedDek"];

export function parseCredentialEnvelope(value: string): CredentialEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid credential envelope JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !== keys.join(",")
  ) {
    throw new Error("Invalid credential envelope shape");
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    candidate.algorithm !== "xchacha20poly1305" ||
    typeof candidate.wrappedDek !== "string" ||
    candidate.wrappedDek.length === 0 ||
    typeof candidate.nonce !== "string" ||
    candidate.nonce.length === 0 ||
    typeof candidate.ciphertext !== "string" ||
    candidate.ciphertext.length === 0
  ) {
    throw new Error("Invalid credential envelope fields");
  }
  return candidate as unknown as CredentialEnvelopeV1;
}

export function serializeCredentialEnvelope(
  envelope: CredentialEnvelopeV1,
): string {
  return JSON.stringify(parseCredentialEnvelope(JSON.stringify(envelope)));
}
