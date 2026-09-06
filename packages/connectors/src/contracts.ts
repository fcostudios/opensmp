export type ConnectorCapability =
  | "provision"
  | "deprovision"
  | "syncMembers"
  | "syncActivity"
  | "syncCost";

export type ConnectorResult<T> =
  | { ok: true; value: T; raw: unknown }
  | { ok: false; code: "unsupported"; checklistSteps: readonly string[] }
  | { ok: false; code: "provider_error"; retryable: boolean; raw: unknown };

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
  syncActivity(input: SyncInput): Promise<ConnectorResult<ActivitySnapshot>>;
  syncCost(input: SyncInput): Promise<ConnectorResult<CostSnapshot>>;
}

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
