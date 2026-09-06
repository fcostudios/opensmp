import type {
  AnthropicCredentialKind,
  AnthropicEndpointPolicy,
} from "./endpoints.js";

export type AnthropicCredentialCandidate = Readonly<{
  vendorAccountId: string;
  kind: AnthropicCredentialKind;
  secret: string;
  status: "active" | "retired";
  health: "ok" | "auth_failed" | "unverified";
}>;

export type ResolvedAnthropicCredentials = Readonly<{
  vendorAccountId: string;
  admin: Readonly<{ kind: "admin_scoped"; secret: string }>;
  analytics: Readonly<{ kind: "analytics"; secret: string }>;
}>;

export type AnthropicCredentialErrorCode =
  | "invalid_vendor_account" | "missing_credential" | "duplicate_credential"
  | "blank_credential" | "identical_credentials" | "inactive_credential"
  | "unhealthy_credential" | "wrong_credential_kind";

export class AnthropicCredentialError extends Error {
  readonly code: AnthropicCredentialErrorCode;

  constructor(code: AnthropicCredentialErrorCode) {
    super(`Anthropic credential error: ${code}`);
    this.name = "AnthropicCredentialError";
    this.code = code;
  }
}

type TaggedCredential = Readonly<{
  kind: AnthropicCredentialKind;
  secret: string;
}>;

type CandidateRecord = Record<string, unknown> & Readonly<{
  vendorAccountId: string;
}>;

function fail(code: AnthropicCredentialErrorCode): never {
  throw new AnthropicCredentialError(code);
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateRecord(value: unknown): CandidateRecord {
  if (!isRecord(value) || !isNonblankString(value.vendorAccountId)) {
    return fail("invalid_vendor_account");
  }
  return value as CandidateRecord;
}

function validateCandidate(value: CandidateRecord): AnthropicCredentialCandidate {
  if (value.kind !== "admin_scoped" && value.kind !== "analytics") {
    return fail("wrong_credential_kind");
  }
  if (!isNonblankString(value.secret)) return fail("blank_credential");
  if (value.status !== "active") return fail("inactive_credential");
  if (value.health !== "ok") return fail("unhealthy_credential");

  return {
    vendorAccountId: value.vendorAccountId,
    kind: value.kind,
    secret: value.secret,
    status: value.status,
    health: value.health,
  };
}

function freezeTaggedCredential<K extends AnthropicCredentialKind>(
  kind: K,
  secret: string,
): Readonly<{ kind: K; secret: string }> {
  return Object.freeze({ kind, secret });
}

export function resolveAnthropicCredentials(
  candidates: readonly unknown[],
  vendorAccountId: string,
): ResolvedAnthropicCredentials {
  if (!isNonblankString(vendorAccountId)) fail("invalid_vendor_account");
  if (!Array.isArray(candidates)) fail("invalid_vendor_account");

  let admin: AnthropicCredentialCandidate | undefined;
  let analytics: AnthropicCredentialCandidate | undefined;
  for (const value of candidates) {
    const record = candidateRecord(value);
    if (record.vendorAccountId !== vendorAccountId) continue;
    const candidate = validateCandidate(record);

    if (candidate.kind === "admin_scoped") {
      if (admin) fail("duplicate_credential");
      admin = candidate;
      continue;
    }
    if (analytics) fail("duplicate_credential");
    analytics = candidate;
  }

  if (!admin || !analytics) fail("missing_credential");
  if (admin.secret === analytics.secret) fail("identical_credentials");

  return Object.freeze({
    vendorAccountId,
    admin: freezeTaggedCredential("admin_scoped", admin.secret),
    analytics: freezeTaggedCredential("analytics", analytics.secret),
  });
}

function selectedCredential(
  value: unknown,
  expectedKind: AnthropicCredentialKind,
): TaggedCredential {
  if (!isRecord(value) || value.kind !== expectedKind) {
    return fail("wrong_credential_kind");
  }
  if (!isNonblankString(value.secret)) return fail("blank_credential");
  return Object.freeze({ kind: expectedKind, secret: value.secret });
}

export function credentialForPolicy(
  credentials: ResolvedAnthropicCredentials,
  policy: Pick<AnthropicEndpointPolicy, "credentialKind">,
): TaggedCredential {
  if (!isRecord(credentials) || !isNonblankString(credentials.vendorAccountId)) {
    return fail("invalid_vendor_account");
  }
  if (!isRecord(policy)) return fail("wrong_credential_kind");

  if (policy.credentialKind === "admin_scoped") {
    return selectedCredential(credentials.admin, "admin_scoped");
  }
  if (policy.credentialKind === "analytics") {
    return selectedCredential(credentials.analytics, "analytics");
  }
  return fail("wrong_credential_kind");
}
