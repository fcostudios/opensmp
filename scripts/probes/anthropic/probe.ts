import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createSanitizedObservation,
  stableSecretHash,
} from "./redact.ts";
import {
  adminLastId,
  inviteId,
  inspectEndpointSchema,
  opaqueNextPage,
  organizationId,
  parseManifest,
  responseHasMore,
  type KeyKind,
  type ProbeManifest,
  type ProbeOrganization,
} from "./schemas.ts";
import { atomicWriteSecureJson } from "./runtime.ts";

const API_ORIGIN = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";
const DEFAULT_MANIFEST = ".env.anthropic-probe-manifest.local";
const DEFAULT_OUTPUT = "docs/spikes/US-054-anthropic-api-probe.runtime.json";
const DEFAULT_CHECKPOINT =
  "docs/spikes/US-054-anthropic-api-probe.checkpoint.json";
const MAX_PAGES = 100;

export interface ProbeDefinition {
  name: string;
  keyKind: KeyKind;
  path: string;
  pagination: "none" | "id_cursor" | "opaque_page";
  betaHeader: string | null;
}

export const probeDefinitions: readonly ProbeDefinition[] = [
  {
    name: "organization",
    keyKind: "admin",
    path: "/v1/organizations/me",
    pagination: "none",
    betaHeader: null,
  },
  {
    name: "members",
    keyKind: "admin",
    path: "/v1/organizations/users",
    pagination: "id_cursor",
    betaHeader: null,
  },
  {
    name: "invites",
    keyKind: "admin",
    path: "/v1/organizations/invites",
    pagination: "id_cursor",
    betaHeader: null,
  },
  {
    name: "activity_users",
    keyKind: "analytics",
    path: "/v1/organizations/analytics/users",
    pagination: "opaque_page",
    betaHeader: null,
  },
  {
    name: "activity_summaries",
    keyKind: "analytics",
    path: "/v1/organizations/analytics/summaries",
    pagination: "none",
    betaHeader: null,
  },
  {
    name: "usage_report",
    keyKind: "analytics",
    path: "/v1/organizations/analytics/usage_report",
    pagination: "opaque_page",
    betaHeader: null,
  },
  {
    name: "cost_report",
    keyKind: "analytics",
    path: "/v1/organizations/analytics/cost_report",
    pagination: "opaque_page",
    betaHeader: null,
  },
] as const;

type ExecutionStep =
  | {
      phase: "read";
      organization: ProbeOrganization;
      definition: ProbeDefinition;
    }
  | {
      phase: "invite_canary";
      organization: ProbeOrganization;
    };

export function buildExecutionSchedule(
  organizations: ProbeOrganization[],
): ExecutionStep[] {
  return [
    ...organizations.flatMap((organization) =>
      probeDefinitions.map((definition) => ({
        phase: "read" as const,
        organization,
        definition,
      })),
    ),
    ...organizations.map((organization) => ({
      phase: "invite_canary" as const,
      organization,
    })),
  ];
}

interface InviteAuthorizationInput {
  allowMutation: string | undefined;
  canaryEmail: string | undefined;
  canaryEmailApproved: string | undefined;
  confirmedVendorAccountRef: string | undefined;
  confirmedAt: string | undefined;
  organizationRef: string;
  now: Date;
}

export type InviteAuthorization =
  | { authorized: true; reason: "all_operator_gates_confirmed" }
  | {
      authorized: false;
      reason:
        | "mutation_not_enabled"
        | "canary_email_missing"
        | "email_not_approved"
        | "vendor_account_not_confirmed"
        | "vendor_account_confirmation_stale";
    };

export function inviteCanaryAuthorization(
  input: InviteAuthorizationInput,
): InviteAuthorization {
  if (input.allowMutation !== "true") {
    return { authorized: false, reason: "mutation_not_enabled" };
  }
  if (!input.canaryEmail) {
    return { authorized: false, reason: "canary_email_missing" };
  }
  if (input.canaryEmailApproved !== "true") {
    return { authorized: false, reason: "email_not_approved" };
  }
  if (input.confirmedVendorAccountRef !== input.organizationRef) {
    return { authorized: false, reason: "vendor_account_not_confirmed" };
  }
  const confirmationTime = input.confirmedAt
    ? Date.parse(input.confirmedAt)
    : Number.NaN;
  const confirmationAge = input.now.getTime() - confirmationTime;
  if (
    !Number.isFinite(confirmationTime) ||
    confirmationAge < 0 ||
    confirmationAge > 5 * 60 * 1_000
  ) {
    return {
      authorized: false,
      reason: "vendor_account_confirmation_stale",
    };
  }
  return { authorized: true, reason: "all_operator_gates_confirmed" };
}

interface CliOptions {
  manifestPath: string;
  outputPath: string;
  checkpointPath: string;
  date: string;
}

function utcYesterday(now = new Date()): string {
  const value = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  return value.toISOString().slice(0, 10);
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifestPath: DEFAULT_MANIFEST,
    outputPath: DEFAULT_OUTPUT,
    checkpointPath: DEFAULT_CHECKPOINT,
    date: utcYesterday(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--manifest" && value) options.manifestPath = value;
    else if (flag === "--output" && value) options.outputPath = value;
    else if (flag === "--checkpoint" && value) options.checkpointPath = value;
    else if (flag === "--date" && value) options.date = value;
    else throw new Error(`unsupported or incomplete argument: ${flag}`);
    index += 1;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error("--date must use YYYY-MM-DD");
  }
  return options;
}

async function loadManifest(
  path: string,
  readText: (path: string) => Promise<string>,
): Promise<ProbeManifest> {
  const serialized = await readText(path);
  return parseManifest(JSON.parse(serialized) as unknown);
}

interface ResolvedKeyPair {
  admin: string;
  analytics: string;
}

export function resolveProbeSecrets(
  manifest: ProbeManifest,
  environment: Record<string, string | undefined>,
): Map<string, ResolvedKeyPair> {
  const resolved = new Map<string, ResolvedKeyPair>();
  for (const organization of manifest.organizations) {
    const admin = environment[organization.adminKeyEnv];
    const analytics = environment[organization.analyticsKeyEnv];
    if (!admin) {
      throw new Error(
        `required secret environment variable is unset: ${organization.adminKeyEnv}`,
      );
    }
    if (!analytics) {
      throw new Error(
        `required secret environment variable is unset: ${organization.analyticsKeyEnv}`,
      );
    }
    if (admin === analytics) {
      throw new Error(
        "resolved Admin and Analytics secrets must differ",
      );
    }
    resolved.set(organization.ref, { admin, analytics });
  }
  return resolved;
}

function requireSecret(
  name: string,
  environment: Record<string, string | undefined>,
): string {
  const value = environment[name];
  if (!value) {
    throw new Error(`required secret environment variable is unset: ${name}`);
  }
  return value;
}

function nextUtcDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function buildProbeQuery(
  definition: ProbeDefinition,
  date: string,
): URLSearchParams {
  const query = new URLSearchParams();
  if (definition.name === "members" || definition.name === "invites") {
    query.set("limit", "1000");
  } else if (
    definition.name === "activity_users" ||
    definition.name === "activity_summaries"
  ) {
    query.set("date", date);
  } else if (
    definition.name === "usage_report" ||
    definition.name === "cost_report"
  ) {
    query.set("starting_at", `${date}T00:00:00Z`);
    query.set("ending_at", `${nextUtcDate(date)}T00:00:00Z`);
    query.set("bucket_width", "1d");
    query.set("limit", "1");
  }
  return query;
}

async function safeJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function request(
  url: URL,
  key: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ response: Response; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("x-api-key", key);
  headers.set("anthropic-version", API_VERSION);
  headers.set("accept", "application/json");
  headers.set("user-agent", "Ledger-US-054-Probe/1.0");
  const response = await fetchImpl(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  return { response, body: await safeJson(response) };
}

async function runReadProbe(input: {
  definition: ProbeDefinition;
  key: string;
  date: string;
  hashSalt: string;
  fetchImpl: typeof fetch;
  expectedOrganizationIdHash: string;
}): Promise<{
  observations: ReturnType<typeof createSanitizedObservation>[];
  providerTargetVerified: boolean | null;
}> {
  const { definition, key, date, hashSalt } = input;
  const observations: ReturnType<typeof createSanitizedObservation>[] = [];
  const query = buildProbeQuery(definition, date);
  let providerTargetVerified: boolean | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(definition.path, API_ORIGIN);
    url.search = query.toString();
    const { response, body } = await request(
      url,
      key,
      {},
      input.fetchImpl,
    );
    observations.push(
      createSanitizedObservation({
        endpoint: definition.name,
        keyKind: definition.keyKind,
        status: response.status,
        headers: response.headers,
        body,
        hashSalt,
        sentBetaHeader: definition.betaHeader,
      }),
    );
    if (definition.name === "organization") {
      providerTargetVerified = verifyProviderOrganization(
        response.status,
        body,
        input.expectedOrganizationIdHash,
        hashSalt,
      );
    }

    if (!response.ok || definition.pagination === "none") break;
    if (definition.pagination === "id_cursor") {
      if (!responseHasMore(body)) break;
      const cursor = adminLastId(body);
      if (!cursor) break;
      query.set("after_id", cursor);
    } else {
      const cursor = opaqueNextPage(body);
      if (!cursor) break;
      query.set("page", cursor);
    }
  }
  return {
    observations,
    providerTargetVerified,
  };
}

export function verifyProviderOrganization(
  status: number,
  body: unknown,
  expectedOrganizationIdHash: string,
  hashSalt: string,
): boolean {
  if (status < 200 || status >= 300) return false;
  if (!inspectEndpointSchema("organization", body).valid) return false;
  const id = organizationId(body);
  return (
    id !== null &&
    stableSecretHash(id, hashSalt) === expectedOrganizationIdHash
  );
}

export function checkpointPathForOrganization(
  basePath: string,
  organizationRefHash: string,
): string {
  const match = /^hmac-sha256:([a-f0-9]{64})$/.exec(organizationRefHash);
  if (!match?.[1]) {
    throw new Error("organization reference hash is not a safe HMAC");
  }
  const extension = extname(basePath);
  const stem = basename(basePath, extension);
  return join(dirname(basePath), `${stem}.${match[1]}${extension || ".json"}`);
}

export async function runInviteCanary(input: {
  organization: ProbeOrganization;
  adminKey: string;
  hashSalt: string;
  organizationRefHash: string;
  providerTargetVerified: boolean;
  checkpointPath: string;
  environment: Record<string, string | undefined>;
  now: () => Date;
  fetchImpl: typeof fetch;
  writeCheckpoint: typeof atomicWriteSecureJson;
}): Promise<Record<string, unknown>> {
  const checkpointFile = basename(input.checkpointPath);
  if (!input.providerTargetVerified) {
    return {
      status: "not_executed",
      reason: "provider_target_not_verified",
      checkpoint_file: checkpointFile,
    };
  }
  const authorization = inviteCanaryAuthorization({
    allowMutation: input.environment.PROBE_ALLOW_INVITE_MUTATION,
    canaryEmail: input.environment.PROBE_CANARY_EMAIL,
    canaryEmailApproved: input.environment.PROBE_CANARY_EMAIL_APPROVED,
    confirmedVendorAccountRef:
      input.environment.PROBE_CONFIRMED_VENDOR_ACCOUNT_REF,
    confirmedAt: input.environment.PROBE_VENDOR_ACCOUNT_CONFIRMED_AT,
    organizationRef: input.organization.ref,
    now: input.now(),
  });
  if (!authorization.authorized) {
    return {
      status: "not_executed",
      reason: authorization.reason,
      checkpoint_file: checkpointFile,
    };
  }

  const key = input.adminKey;
  const canaryEmail = input.environment.PROBE_CANARY_EMAIL as string;
  const createUrl = new URL("/v1/organizations/invites", API_ORIGIN);
  let createdInviteId: string | null = null;
  let createObservation: ReturnType<typeof createSanitizedObservation> | null =
    null;
  let cleanupObservation: ReturnType<typeof createSanitizedObservation> | null =
    null;
  let createTransportFailure = false;
  let cleanupTransportFailure = false;
  let checkpointPersistenceFailure = false;
  const checkpointBase = {
    checkpoint_version: 1,
    organization_ref_hash: input.organizationRefHash,
    provider_target_verified: true,
  };

  const persistCheckpoint = async (
    state: string,
    manualReviewRequired: boolean,
  ): Promise<boolean> => {
    try {
      await input.writeCheckpoint(input.checkpointPath, {
        ...checkpointBase,
        state,
        manual_review_required: manualReviewRequired,
        updated_at: input.now().toISOString(),
      });
      return true;
    } catch {
      checkpointPersistenceFailure = true;
      return false;
    }
  };

  if (!(await persistCheckpoint("authorized_canary_pending", true))) {
    return {
      status: "indeterminate_manual_review_required",
      checkpoint_file: checkpointFile,
      checkpoint: { classification: "checkpoint_persistence_failure" },
      create: { status: "not_attempted" },
      cleanup: null,
    };
  }

  try {
    const created = await request(
      createUrl,
      key,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: canaryEmail, role: "user" }),
      },
      input.fetchImpl,
    );
    createObservation = createSanitizedObservation({
      endpoint: "invite_canary_create",
      keyKind: "admin",
      status: created.response.status,
      headers: created.response.headers,
      body: created.body,
      hashSalt: input.hashSalt,
      sentBetaHeader: null,
    });
    const createIsValid =
      created.response.status >= 200 &&
      created.response.status < 300 &&
      createObservation.schema.valid;
    createdInviteId = createIsValid ? inviteId(created.body) : null;
    await persistCheckpoint(
      createIsValid && createdInviteId
        ? "invite_create_confirmed"
        : created.response.ok
          ? "invite_create_indeterminate"
          : "invite_create_rejected",
      true,
    );
  } catch {
    createTransportFailure = true;
    await persistCheckpoint("invite_create_indeterminate", true);
  }

  if (createdInviteId) {
    try {
      const deleteUrl = new URL(
        `/v1/organizations/invites/${encodeURIComponent(createdInviteId)}`,
        API_ORIGIN,
      );
      const deleted = await request(
        deleteUrl,
        key,
        { method: "DELETE" },
        input.fetchImpl,
      );
      cleanupObservation = createSanitizedObservation({
        endpoint: "invite_canary_delete",
        keyKind: "admin",
        status: deleted.response.status,
        headers: deleted.response.headers,
        body: deleted.body,
        hashSalt: input.hashSalt,
        sentBetaHeader: null,
      });
      const cleanupSucceeded =
        deleted.response.ok && cleanupObservation.schema.valid;
      await persistCheckpoint(
        cleanupSucceeded
          ? "invite_cleanup_confirmed"
          : "invite_cleanup_indeterminate",
        !cleanupSucceeded,
      );
    } catch {
      cleanupTransportFailure = true;
      await persistCheckpoint("invite_cleanup_indeterminate", true);
    }
  }

  const outcome = checkpointPersistenceFailure
    ? "indeterminate_manual_review_required"
    : classifyInviteCanaryOutcome({
        createStatus: createObservation?.status ?? null,
        hasInviteId: createdInviteId !== null,
        cleanupStatus:
          cleanupObservation?.schema.valid === true
            ? cleanupObservation.status
            : null,
        createTransportFailure,
        cleanupTransportFailure,
      });
  return {
    status: outcome,
    checkpoint_file: checkpointFile,
    checkpoint: checkpointPersistenceFailure
      ? { classification: "checkpoint_persistence_failure" }
      : { classification: "persisted" },
    create: createTransportFailure
      ? { classification: "network_or_transport_failure" }
      : createObservation,
    cleanup: cleanupTransportFailure
      ? {
          status: "indeterminate_manual_review_required",
          classification: "network_or_transport_failure",
        }
      : cleanupObservation ??
        (outcome === "indeterminate_manual_review_required"
          ? { status: "not_confirmed" }
          : null),
  };
}

export type InviteCanaryOutcome =
  | "attempted_not_created"
  | "executed_and_cleaned_up"
  | "indeterminate_manual_review_required";

export function classifyInviteCanaryOutcome(input: {
  createStatus: number | null;
  hasInviteId: boolean;
  cleanupStatus: number | null;
  createTransportFailure: boolean;
  cleanupTransportFailure: boolean;
}): InviteCanaryOutcome {
  if (input.createTransportFailure) {
    return "indeterminate_manual_review_required";
  }
  const createSucceeded =
    input.createStatus !== null &&
    input.createStatus >= 200 &&
    input.createStatus < 300;
  if (!createSucceeded) return "attempted_not_created";
  if (!input.hasInviteId || input.cleanupTransportFailure) {
    return "indeterminate_manual_review_required";
  }
  const cleanupSucceeded =
    input.cleanupStatus !== null &&
    input.cleanupStatus >= 200 &&
    input.cleanupStatus < 300;
  return cleanupSucceeded
    ? "executed_and_cleaned_up"
    : "indeterminate_manual_review_required";
}

export interface ProbeRuntime {
  environment: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: () => Date;
  readText: (path: string) => Promise<string>;
  writeSecureJson: typeof atomicWriteSecureJson;
}

export async function runProbe(
  options: CliOptions,
  runtime: ProbeRuntime,
): Promise<{
  artifact: Record<string, unknown>;
  manualReviewRequired: boolean;
}> {
  const manifest = await loadManifest(options.manifestPath, runtime.readText);
  // Resolve and compare every key family before the execution schedule can
  // issue its first network request.
  const resolvedSecrets = resolveProbeSecrets(
    manifest,
    runtime.environment,
  );
  const hashSalt = requireSecret("PROBE_HASH_SALT", runtime.environment);
  if (hashSalt.length < 32) {
    throw new Error("PROBE_HASH_SALT must contain at least 32 characters");
  }

  const working = new Map(
    manifest.organizations.map((organization) => [
      organization.ref,
      {
        organization,
        organization_ref_hash: stableSecretHash(
          organization.ref,
          hashSalt,
        ),
        observations: [] as ReturnType<
          typeof createSanitizedObservation
        >[],
        invite_canary: {
          status: "not_executed",
          reason: "phase_not_reached",
        } as Record<string, unknown>,
        provider_target_verified: false,
      },
    ]),
  );

  for (const step of buildExecutionSchedule(manifest.organizations)) {
    const result = working.get(step.organization.ref);
    if (!result) throw new Error("internal organization schedule mismatch");
    const keys = resolvedSecrets.get(step.organization.ref);
    if (!keys) throw new Error("internal secret preflight mismatch");
    if (step.phase === "read") {
      const readResult = await runReadProbe({
        definition: step.definition,
        key:
          step.definition.keyKind === "admin"
            ? keys.admin
            : keys.analytics,
        date: options.date,
        hashSalt,
        fetchImpl: runtime.fetchImpl,
        expectedOrganizationIdHash:
          step.organization.expectedOrganizationIdHash,
      });
      result.observations.push(...readResult.observations);
      if (readResult.providerTargetVerified !== null) {
        result.provider_target_verified =
          readResult.providerTargetVerified;
      }
    } else {
      result.invite_canary = await runInviteCanary({
        organization: step.organization,
        adminKey: keys.admin,
        hashSalt,
        organizationRefHash: result.organization_ref_hash,
        providerTargetVerified: result.provider_target_verified,
        checkpointPath: checkpointPathForOrganization(
          options.checkpointPath,
          result.organization_ref_hash,
        ),
        environment: runtime.environment,
        now: runtime.now,
        fetchImpl: runtime.fetchImpl,
        writeCheckpoint: runtime.writeSecureJson,
      });
    }
  }

  const organizationArtifacts = [...working.values()].map(
    ({ organization: _secretRoutingOnly, ...artifact }) => artifact,
  );
  return {
    artifact: {
      artifact_version: 1,
      generated_at: runtime.now().toISOString(),
      requested_utc_date: options.date,
      api_origin: API_ORIGIN,
      anthropic_version: API_VERSION,
      raw_bodies_persisted: false,
      organizations: organizationArtifacts,
    },
    manualReviewRequired: organizationArtifacts.some(
      ({ invite_canary }) =>
        invite_canary.status ===
        "indeterminate_manual_review_required",
    ),
  };
}

export async function writeSanitizedArtifact(
  outputPath: string,
  artifact: Record<string, unknown>,
): Promise<void> {
  await atomicWriteSecureJson(outputPath, artifact);
}

export async function executeProbeCli(input: {
  argv: string[];
  runtime: ProbeRuntime;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}): Promise<number> {
  try {
    const options = parseCli(input.argv);
    const result = await runProbe(options, input.runtime);
    await input.runtime.writeSecureJson(options.outputPath, result.artifact);
    if (result.manualReviewRequired) {
      input.stderr(
        `${JSON.stringify({
          status: "canary_manual_review_required",
        })}\n`,
      );
      return 2;
    }
    input.stdout(
      `${JSON.stringify({
        status: "sanitized_artifact_written",
        output: options.outputPath,
        organizations: Array.isArray(result.artifact.organizations)
          ? result.artifact.organizations.length
          : 0,
      })}\n`,
    );
    return 0;
  } catch (error: unknown) {
    const category =
      error instanceof SyntaxError
        ? "invalid_manifest_json"
        : "probe_failed";
    input.stderr(`${JSON.stringify({ status: category })}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  executeProbeCli({
    argv: process.argv.slice(2),
    runtime: {
      environment: process.env,
      fetchImpl: fetch,
      now: () => new Date(),
      readText: (path) => readFile(path, "utf8"),
      writeSecureJson: atomicWriteSecureJson,
    },
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
