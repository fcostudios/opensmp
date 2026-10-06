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
export type MemberSnapshot = {
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
  records: readonly { email: string; costDate: string; amountUsd: string }[];
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
