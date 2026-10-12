export type ConnectorCapability =
  | "provision"
  | "deprovision"
  | "syncMembers"
  | "syncActivity"
  | "syncCost";

export const connectorFailureCodes = Object.freeze([
  "provider_error",
  "capacity_unavailable",
] as const);
export type ConnectorFailureCode = (typeof connectorFailureCodes)[number];

export function isConnectorFailureCode(value: unknown): value is ConnectorFailureCode {
  return connectorFailureCodes.some((code) => code === value);
}

export type ConnectorResult<T> =
  | { ok: true; value: T; raw: unknown }
  | { ok: false; code: "unsupported"; checklistSteps: readonly string[] }
  | { ok: false; code: "provider_error"; retryable: boolean; raw: unknown }
  | {
    ok: false;
    code: "capacity_unavailable";
    retryable: false;
    raw: { readonly failure_code: "capacity_unavailable" };
  };

export type ProvisionInput = {
  requestId: string;
  vendorAccountId: string;
  personEmail: string;
  licenseTypeName: string;
};
export type ProvisionResult = { vendorRef: string | null };
export type DeprovisionInput = ProvisionInput;
export type DeprovisionResult = { vendorRef: string | null };
export type SyncInput = { vendorAccountId: string; observedAt: Date };
export type MemberSeatEvidence = "licensed" | "unlicensed" | "unknown";
export type MemberEvidenceDescriptor = Readonly<{
  member_seat_evidence: "provider_field" | "all_members_licensed" | "none";
  member_license_identity: "provider_field" | "none";
}>;
export type ConnectorMemberRecord = Readonly<{
  provider_member_ref: string | null;
  email: string | null;
  display_name: string | null;
  membership_status: "member" | "invited";
  reported_role: string | null;
  seat_evidence: MemberSeatEvidence;
  seat_evidence_provenance: string | null;
  provider_license_ref: string | null;
}>;
export type NormalizedMemberRecord = ConnectorMemberRecord & Readonly<{ license_type_id: string | null }>;
export type MemberIdentityWarning = Readonly<{
  kind: "null_email" | "ambiguous_identity" | "unmapped_license" | "unknown_seat_evidence";
  provider_member_ref: string | null;
  email: string | null;
  detail: string;
}>;

/** Optional compatibility envelope; a legacy projection is never authoritative evidence. */
export function validateMemberEvidence(value: unknown): Readonly<{
  records: readonly ConnectorMemberRecord[];
  evidence: MemberEvidenceDescriptor;
}> | null {
  const invalid = (): never => { throw new Error("Invalid connector member evidence"); };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const envelope = value as Record<string, unknown>;
  const hasRecords = Object.hasOwn(envelope, "records"), hasEvidence = Object.hasOwn(envelope, "evidence");
  if (!hasRecords && !hasEvidence) return null;
  if (!hasRecords || !hasEvidence) return invalid();
  const evidence = envelope.evidence as Record<string, unknown>;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)
    || Object.keys(evidence).length !== 2
    || !["provider_field", "all_members_licensed", "none"].includes(evidence.member_seat_evidence as string)
    || !["provider_field", "none"].includes(evidence.member_license_identity as string)) return invalid();
  const nullableText = (input: unknown): boolean => input === null || (typeof input === "string" && input.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(input));
  const keys = ["provider_member_ref", "email", "display_name", "membership_status", "reported_role", "seat_evidence", "seat_evidence_provenance", "provider_license_ref"];
  if (!Array.isArray(envelope.records) || !envelope.records.every(input => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const record = input as Record<string, unknown>;
    return Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key))
      && [record.provider_member_ref, record.display_name, record.reported_role, record.provider_license_ref, record.seat_evidence_provenance].every(nullableText)
      && (record.email === null || (typeof record.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(record.email)))
      && ["member", "invited"].includes(record.membership_status as string)
      && ["licensed", "unlicensed", "unknown"].includes(record.seat_evidence as string)
      && (record.membership_status !== "invited" || record.seat_evidence === "unlicensed");
  })) return invalid();
  assertJsonValue({ records: envelope.records, evidence }, "memberEvidence");
  return { records: envelope.records as ConnectorMemberRecord[], evidence: evidence as MemberEvidenceDescriptor };
}

export type MemberSnapshot = {
  records?: readonly ConnectorMemberRecord[];
  evidence?: MemberEvidenceDescriptor;
  members: readonly { email: string; active: boolean }[];
};
export const memberPageStreams = Object.freeze(["members", "invitations"] as const);
export type MemberPageStream = (typeof memberPageStreams)[number];

export function isMemberPageStream(value: unknown): value is MemberPageStream {
  return memberPageStreams.some((stream) => stream === value);
}

/** The same safe opaque-token grammar applies at direct and dispatched page boundaries. */
export function isMemberPageToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Bidi_Control}\ud800-\udfff]/u.test(value);
}

export type MemberPageCursor = Readonly<{
  stream: MemberPageStream;
  pageCount: number;
  memberSetSize: number;
}>;
/**
 * Sensitive provider paging state. This is deliberately separate from
 * `MemberPageCursor`: callers must encrypt and account-bind it before durable
 * storage, while `MemberPageCursor` is safe poll evidence.
 */
export type MemberPageResume = Readonly<{
  vendorAccountId: string;
  stream: MemberPageStream;
  continuation: string | null;
  seenContinuations: readonly string[];
  /** Bound to the public cursor so independently saved fragments cannot restart paging. */
  pageCount: number;
  memberSetSize: number;
}>;
export type SyncMemberPageInput = SyncInput & {
  cursor: MemberPageCursor | null;
  resume?: MemberPageResume | null;
};
export type MemberPageSnapshot = {
  records?: readonly ConnectorMemberRecord[];
  evidence?: MemberEvidenceDescriptor;
  members: readonly { email: string; active: boolean }[];
  cursor: MemberPageCursor | null;
  resume: MemberPageResume | null;
  pageCount: number;
  memberSetSize: number;
  complete: boolean;
};
export type ActivitySnapshot = {
  records: readonly ActivityIngestionRecord[];
};
export type CostSnapshot = {
  records: readonly CostIngestionRecord[];
};

export type InvitationWithdrawalResult =
  | { readonly ok: true; readonly vendorRef: string; readonly receipt: { readonly id: string; readonly type: "invite_deleted" } }
  | { readonly ok: false; readonly code: "provider_error"; readonly retryable: boolean; readonly raw: null };

/** The invitation-only success receipt is also the durable recovery contract. */
export function isInvitationDeletionReceipt(value: unknown, reference: string): value is { readonly id: string; readonly type: "invite_deleted" } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt=value as Record<string,unknown>;
  const keys=Object.keys(receipt).sort();
  return keys.length === 2 && keys[0] === "id" && keys[1] === "type" && receipt.id === reference && receipt.type === "invite_deleted";
}

export interface VendorConnector {
  withdrawInvitation?(input: { requestId: string; vendorAccountId: string; vendorRef: string }): Promise<InvitationWithdrawalResult>;
  capabilities(): ReadonlySet<ConnectorCapability>;
  provision(input: ProvisionInput): Promise<ConnectorResult<ProvisionResult>>;
  deprovision(input: DeprovisionInput): Promise<ConnectorResult<DeprovisionResult>>;
  syncMembers(input: SyncInput): Promise<ConnectorResult<MemberSnapshot>>;
  syncMemberPage(input: SyncMemberPageInput): Promise<ConnectorResult<MemberPageSnapshot>>;
  syncActivity(input: SyncInput): Promise<ConnectorResult<ActivitySnapshot>>;
  syncCost(input: SyncInput): Promise<ConnectorResult<CostSnapshot>>;
}

export type LegacyVendorConnector = Omit<VendorConnector, "syncMemberPage"> & {
  syncMemberPage?: VendorConnector["syncMemberPage"];
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function assertJsonValue(
  value: unknown,
  path = "value",
  ancestors: ReadonlySet<object> = new Set(),
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") {
    throw new Error(`Connector JSON value is not JSON-safe: ${path}`);
  }
  if (ancestors.has(value)) {
    throw new Error(`Connector JSON value is not JSON-safe: ${path}`);
  }
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      assertJsonValue(item, `${path}[${index}]`, nextAncestors),
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Connector JSON value is not JSON-safe: ${path}`);
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = assertJsonValue(item, `${path}.${key}`, nextAncestors);
  }
  return result;
}


export type IngestionSource = "api" | "csv_import" | "manual";
export type ActivityIngestionRecord = Readonly<{
  email: string | null;
  providerUserId: string | null;
  activityDate: string;
  counters: JsonValue;
}>;
export type ActivityIdentityWarning = Readonly<{
  recordIndex: number;
  reason: "missing_email" | "unmatched_email";
  email: string | null;
  providerUserId: string | null;
}>;

type CounterShape = { readonly [key: string]: CounterShape | true };

/** Reconstruct only supported metrics; never inspect or retain unknown provider data. */
export function normalizeActivityCounters(value: unknown): JsonValue {
  const chatCounters = "connectors_used_count distinct_artifacts_created_count distinct_connectors_used_count distinct_conversation_count distinct_files_uploaded_count distinct_projects_created_count distinct_projects_used_count distinct_shared_artifacts_viewed_count distinct_skills_used_count message_count shared_conversations_viewed_count thinking_message_count";
  const coworkCounters = "action_count artifacts_created_count connectors_used_count dispatch_turn_count distinct_connectors_used_count distinct_session_count distinct_skills_used_count message_count skills_used_count distinct_plugins_used_count edit_tool_count file_edit_count multi_edit_tool_count notebook_edit_tool_count plugins_used_count sessions_with_file_edits_count write_tool_count";
  function countShape(names: string): CounterShape {
    return Object.fromEntries(names.split(" ").map(name => [name, true]));
  }
  const activityCounterShape: CounterShape = {
    chat_metrics: countShape(chatCounters),
    claude_code_metrics: {
      core_metrics: {
        ...countShape("artifacts_created_count commit_count distinct_session_count pull_request_count"),
        lines_of_code: countShape("added_count removed_count"),
      },
      tool_actions: Object.fromEntries(
        ["edit_tool", "multi_edit_tool", "notebook_edit_tool", "write_tool"]
          .map(name => [name, countShape("accepted_count rejected_count")]),
      ),
    },
    cowork_metrics: countShape(coworkCounters),
  };
  function normalize(input: unknown, shape: CounterShape, path: string): JsonValue {
    if (input === null || typeof input !== "object" || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
      throw new Error(`Invalid activity metric object: ${path}`);
    }
    const object = input as Record<string, unknown>;
    const result: Record<string, JsonValue> = {};
    for (const [key, nested] of Object.entries(shape)) {
      if (!Object.hasOwn(object, key)) continue;
      const metric = object[key];
      if (metric === null) result[key] = null;
      else if (nested === true) {
        if (typeof metric !== "number" || !Number.isFinite(metric)
          || !Number.isInteger(metric) || metric < 0) {
          throw new Error(`Invalid activity count: ${path}.${key}`);
        }
        result[key] = metric;
      } else result[key] = normalize(metric, nested, `${path}.${key}`);
    }
    return result;
  }
  return normalize(value, activityCounterShape, "counters");
}


export type CostIngestionRecord = Readonly<{
  email: string | null;
  providerUserId: string | null;
  costDate: string;
  amountUsd: string;
  amountCents: string | null;
}>;

/** Exact NUMERIC(12,4) USD: no floating point, rounding or precision loss. */
function costUnits(value: unknown, fractionalDigits: number): bigint {
  if (typeof value !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Invalid cost decimal");
  }
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > fractionalDigits) throw new Error("Cost precision exceeds four USD decimals");
  const magnitude = BigInt(whole!) * BigInt("10") ** BigInt(fractionalDigits)
    + BigInt(significantFraction.padEnd(fractionalDigits, "0"));
  if (magnitude > BigInt("999999999999")) throw new Error("Cost amount exceeds USD bound");
  return negative ? -magnitude : magnitude;
}

function costUsdFromUnits(units: bigint): string {
  const negative = units < BigInt("0");
  const digits = (negative ? -units : units).toString().padStart(5, "0");
  const whole = digits.slice(0, -4);
  const fraction = digits.slice(-4).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function normalizeCostUsd(value: unknown): string {
  return costUsdFromUnits(costUnits(value, 4));
}

export function fractionalCentsToUsd(value: unknown): string {
  return costUsdFromUnits(costUnits(value, 2));
}
