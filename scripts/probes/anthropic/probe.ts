import { chmod, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  createSanitizedObservation,
  stableSecretHash,
} from "./redact.ts";
import {
  adminLastId,
  inviteId,
  opaqueNextPage,
  parseManifest,
  responseHasMore,
  type KeyKind,
  type ProbeManifest,
  type ProbeOrganization,
} from "./schemas.ts";

const API_ORIGIN = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";
const DEFAULT_MANIFEST = ".env.anthropic-probe-manifest.local";
const DEFAULT_OUTPUT = "docs/spikes/US-054-anthropic-api-probe.runtime.json";
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
    date: utcYesterday(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--manifest" && value) options.manifestPath = value;
    else if (flag === "--output" && value) options.outputPath = value;
    else if (flag === "--date" && value) options.date = value;
    else throw new Error(`unsupported or incomplete argument: ${flag}`);
    index += 1;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error("--date must use YYYY-MM-DD");
  }
  return options;
}

async function loadManifest(path: string): Promise<ProbeManifest> {
  const serialized = await readFile(path, "utf8");
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

function requireSecret(name: string): string {
  const value = process.env[name];
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
): Promise<{ response: Response; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("x-api-key", key);
  headers.set("anthropic-version", API_VERSION);
  headers.set("accept", "application/json");
  headers.set("user-agent", "Ledger-US-054-Probe/1.0");
  const response = await fetch(url, {
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
}): Promise<ReturnType<typeof createSanitizedObservation>[]> {
  const { definition, key, date, hashSalt } = input;
  const observations: ReturnType<typeof createSanitizedObservation>[] = [];
  const query = buildProbeQuery(definition, date);

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(definition.path, API_ORIGIN);
    url.search = query.toString();
    const { response, body } = await request(url, key);
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
  return observations;
}

async function runInviteCanary(input: {
  organization: ProbeOrganization;
  adminKey: string;
  hashSalt: string;
}): Promise<Record<string, unknown>> {
  const authorization = inviteCanaryAuthorization({
    allowMutation: process.env.PROBE_ALLOW_INVITE_MUTATION,
    canaryEmail: process.env.PROBE_CANARY_EMAIL,
    canaryEmailApproved: process.env.PROBE_CANARY_EMAIL_APPROVED,
    confirmedVendorAccountRef:
      process.env.PROBE_CONFIRMED_VENDOR_ACCOUNT_REF,
    confirmedAt: process.env.PROBE_VENDOR_ACCOUNT_CONFIRMED_AT,
    organizationRef: input.organization.ref,
    now: new Date(),
  });
  if (!authorization.authorized) {
    return {
      status: "not_executed",
      reason: authorization.reason,
    };
  }

  const key = input.adminKey;
  const canaryEmail = process.env.PROBE_CANARY_EMAIL as string;
  const createUrl = new URL("/v1/organizations/invites", API_ORIGIN);
  let createdInviteId: string | null = null;
  let createObservation: ReturnType<typeof createSanitizedObservation> | null =
    null;
  let cleanupObservation: ReturnType<typeof createSanitizedObservation> | null =
    null;
  let createTransportFailure = false;
  let cleanupTransportFailure = false;

  try {
    try {
      const created = await request(createUrl, key, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: canaryEmail, role: "user" }),
      });
      createdInviteId = inviteId(created.body);
      createObservation = createSanitizedObservation({
        endpoint: "invite_canary_create",
        keyKind: "admin",
        status: created.response.status,
        headers: created.response.headers,
        body: created.body,
        hashSalt: input.hashSalt,
        sentBetaHeader: null,
      });
    } catch {
      createTransportFailure = true;
    }
  } finally {
    if (createdInviteId) {
      try {
        const deleteUrl = new URL(
          `/v1/organizations/invites/${encodeURIComponent(createdInviteId)}`,
          API_ORIGIN,
        );
        const deleted = await request(deleteUrl, key, { method: "DELETE" });
        cleanupObservation = createSanitizedObservation({
          endpoint: "invite_canary_delete",
          keyKind: "admin",
          status: deleted.response.status,
          headers: deleted.response.headers,
          body: deleted.body,
          hashSalt: input.hashSalt,
          sentBetaHeader: null,
        });
      } catch {
        cleanupTransportFailure = true;
      }
    }
  }

  const outcome = classifyInviteCanaryOutcome({
    createStatus: createObservation?.status ?? null,
    hasInviteId: createdInviteId !== null,
    cleanupStatus: cleanupObservation?.status ?? null,
    createTransportFailure,
    cleanupTransportFailure,
  });
  return {
    status: outcome,
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

async function runProbe(options: CliOptions): Promise<Record<string, unknown>> {
  const manifest = await loadManifest(options.manifestPath);
  // Resolve and compare every key family before the execution schedule can
  // issue its first network request.
  const resolvedSecrets = resolveProbeSecrets(manifest, process.env);
  const hashSalt = requireSecret("PROBE_HASH_SALT");
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
      },
    ]),
  );

  for (const step of buildExecutionSchedule(manifest.organizations)) {
    const result = working.get(step.organization.ref);
    if (!result) throw new Error("internal organization schedule mismatch");
    const keys = resolvedSecrets.get(step.organization.ref);
    if (!keys) throw new Error("internal secret preflight mismatch");
    if (step.phase === "read") {
      result.observations.push(
        ...(await runReadProbe({
          definition: step.definition,
          key:
            step.definition.keyKind === "admin"
              ? keys.admin
              : keys.analytics,
          date: options.date,
          hashSalt,
        })),
      );
    } else {
      result.invite_canary = await runInviteCanary({
        organization: step.organization,
        adminKey: keys.admin,
        hashSalt,
      });
    }
  }

  return {
    artifact_version: 1,
    generated_at: new Date().toISOString(),
    requested_utc_date: options.date,
    api_origin: API_ORIGIN,
    anthropic_version: API_VERSION,
    raw_bodies_persisted: false,
    organizations: [...working.values()].map(
      ({ organization: _secretRoutingOnly, ...artifact }) => artifact,
    ),
  };
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const artifact = await runProbe(options);
  await writeSanitizedArtifact(options.outputPath, artifact);
  process.stdout.write(
    `${JSON.stringify({
      status: "sanitized_artifact_written",
      output: options.outputPath,
      organizations: Array.isArray(artifact.organizations)
        ? artifact.organizations.length
        : 0,
    })}\n`,
  );
}

export async function writeSanitizedArtifact(
  outputPath: string,
  artifact: Record<string, unknown>,
): Promise<void> {
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    mode: 0o600,
  });
  // writeFile's mode is ignored when overwriting an existing file.
  await chmod(outputPath, 0o600);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const category =
      error instanceof SyntaxError
        ? "invalid_manifest_json"
        : "probe_failed";
    process.stderr.write(`${JSON.stringify({ status: category })}\n`);
    process.exitCode = 1;
  });
}
