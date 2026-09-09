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
  records: readonly { email: string; activityDate: string; counters: unknown }[];
};
export type CostSnapshot = {
  records: readonly { email: string; costDate: string; amountUsd: string }[];
};

export interface VendorConnector {
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
