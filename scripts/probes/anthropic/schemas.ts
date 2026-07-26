export type KeyKind = "admin" | "analytics";
export type PaginationKind = "none" | "id_cursor" | "opaque_page";

export interface ProbeOrganization {
  ref: string;
  adminKeyEnv: string;
  analyticsKeyEnv: string;
  expectedOrganizationIdHash: string;
}

export interface ProbeManifest {
  organizations: ProbeOrganization[];
}

export interface SchemaInspection {
  valid: boolean;
  pagination: PaginationKind;
  itemCount: number;
  hasMore: boolean;
  hasNextCursor: boolean;
  fieldTypes: string[];
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ORG_REF = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/;
const HMAC_SHA256 = /^hmac-sha256:[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseManifest(value: unknown): ProbeManifest {
  if (!isRecord(value) || !Array.isArray(value.organizations)) {
    throw new Error("manifest must contain an organizations array");
  }
  if (value.organizations.length === 0) {
    throw new Error("manifest must contain at least one organization");
  }

  const refs = new Set<string>();
  const keyEnvironments = new Set<string>();
  const organizations = value.organizations.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`organizations[${index}] must be an object`);
    }
    const {
      ref,
      adminKeyEnv,
      analyticsKeyEnv,
      expectedOrganizationIdHash,
    } = candidate;
    if (typeof ref !== "string" || !ORG_REF.test(ref)) {
      throw new Error(`organizations[${index}].ref is invalid`);
    }
    if (refs.has(ref)) {
      throw new Error(`duplicate organization ref: ${ref}`);
    }
    refs.add(ref);

    if (typeof adminKeyEnv !== "string" || !ENV_NAME.test(adminKeyEnv)) {
      throw new Error(`organizations[${index}].adminKeyEnv is invalid`);
    }
    if (
      typeof analyticsKeyEnv !== "string" ||
      !ENV_NAME.test(analyticsKeyEnv)
    ) {
      throw new Error(`organizations[${index}].analyticsKeyEnv is invalid`);
    }
    if (adminKeyEnv === analyticsKeyEnv) {
      throw new Error(
        "Admin and Analytics key environment variables must differ",
      );
    }
    if (
      typeof expectedOrganizationIdHash !== "string" ||
      !HMAC_SHA256.test(expectedOrganizationIdHash)
    ) {
      throw new Error(
        `organizations[${index}].expectedOrganizationIdHash is invalid`,
      );
    }
    if (
      keyEnvironments.has(adminKeyEnv) ||
      keyEnvironments.has(analyticsKeyEnv)
    ) {
      throw new Error("each organization must use distinct key variables");
    }
    keyEnvironments.add(adminKeyEnv);
    keyEnvironments.add(analyticsKeyEnv);

    return {
      ref,
      adminKeyEnv,
      analyticsKeyEnv,
      expectedOrganizationIdHash,
    };
  });

  return { organizations };
}

function scalarType(value: unknown): string {
  if (value === null) return "null";
  return typeof value;
}

export function collectFieldTypes(
  value: unknown,
  path = "",
  output = new Set<string>(),
): string[] {
  if (Array.isArray(value)) {
    const arrayPath = `${path}[]`;
    if (value.length === 0) {
      output.add(`${arrayPath}:unknown`);
    } else {
      for (const item of value) collectFieldTypes(item, arrayPath, output);
    }
  } else if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      const childPath = path ? `${path}.${key}` : key;
      collectFieldTypes(value[key], childPath, output);
    }
  } else if (path) {
    output.add(`${path}:${scalarType(value)}`);
  }
  return [...output].sort();
}

export function inspectAdminPage(value: unknown): SchemaInspection {
  const record = isRecord(value) ? value : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const hasMore = record.has_more === true;
  const firstCursorIsValid =
    typeof record.first_id === "string" || record.first_id === null;
  const lastCursorIsValid =
    typeof record.last_id === "string" || record.last_id === null;
  const valid =
    Array.isArray(record.data) &&
    typeof record.has_more === "boolean" &&
    firstCursorIsValid &&
    lastCursorIsValid;

  return {
    valid,
    pagination: "id_cursor",
    itemCount: data.length,
    hasMore,
    hasNextCursor: typeof record.last_id === "string",
    fieldTypes: collectFieldTypes(value),
  };
}

export function inspectAnalyticsPage(value: unknown): SchemaInspection {
  const record = isRecord(value) ? value : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const nextPageIsValid =
    typeof record.next_page === "string" || record.next_page === null;
  const hasMore =
    record.has_more === true || typeof record.next_page === "string";

  return {
    valid: Array.isArray(record.data) && nextPageIsValid,
    pagination: "opaque_page",
    itemCount: data.length,
    hasMore,
    hasNextCursor: typeof record.next_page === "string",
    fieldTypes: collectFieldTypes(value),
  };
}

export function inspectOrganization(value: unknown): SchemaInspection {
  const record = isRecord(value) ? value : {};
  return {
    valid:
      record.type === "organization" &&
      typeof record.id === "string" &&
      typeof record.name === "string",
    pagination: "none",
    itemCount: isRecord(value) ? 1 : 0,
    hasMore: false,
    hasNextCursor: false,
    fieldTypes: collectFieldTypes(value),
  };
}

export function inspectSummaries(value: unknown): SchemaInspection {
  const record = isRecord(value) ? value : {};
  const summaries = Array.isArray(record.summaries) ? record.summaries : [];
  return {
    valid: Array.isArray(record.summaries),
    pagination: "none",
    itemCount: summaries.length,
    hasMore: false,
    hasNextCursor: false,
    fieldTypes: collectFieldTypes(value),
  };
}

export function inspectEndpointSchema(
  endpoint: string,
  value: unknown,
): SchemaInspection {
  if (endpoint === "organization") return inspectOrganization(value);
  if (endpoint === "invite_canary_create") {
    const record = isRecord(value) ? value : {};
    return {
      valid:
        record.type === "invite" &&
        typeof record.id === "string" &&
        typeof record.email === "string" &&
        typeof record.status === "string",
      pagination: "none",
      itemCount: isRecord(value) ? 1 : 0,
      hasMore: false,
      hasNextCursor: false,
      fieldTypes: collectFieldTypes(value),
    };
  }
  if (endpoint === "invite_canary_delete") {
    const record = isRecord(value) ? value : {};
    return {
      valid:
        record.type === "invite_deleted" &&
        typeof record.id === "string",
      pagination: "none",
      itemCount: isRecord(value) ? 1 : 0,
      hasMore: false,
      hasNextCursor: false,
      fieldTypes: collectFieldTypes(value),
    };
  }
  if (endpoint === "members" || endpoint === "invites") {
    return inspectAdminPage(value);
  }
  if (endpoint === "activity_summaries") return inspectSummaries(value);
  const inspection = inspectAnalyticsPage(value);
  if (
    endpoint === "cost_report" ||
    endpoint === "user_cost_report"
  ) {
    return {
      ...inspection,
      valid: inspection.valid && hasValidDecimalAmounts(value),
    };
  }
  return inspection;
}

function hasValidDecimalAmounts(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(hasValidDecimalAmounts);
  }
  if (!isRecord(value)) return true;
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === "amount" || key === "list_amount") &&
      (typeof child !== "string" || !PLAIN_DECIMAL.test(child))
    ) {
      return false;
    }
    if (!hasValidDecimalAmounts(child)) return false;
  }
  return true;
}

export type HttpClassification =
  | "success"
  | "invalid_request"
  | "authentication_failed"
  | "authorization_or_key_type_mismatch"
  | "route_or_header_behavior_not_available"
  | "conflict"
  | "rate_limited"
  | "provider_error"
  | "unexpected_status";

export function classifyHttpResult(status: number): HttpClassification {
  if (status >= 200 && status < 300) return "success";
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 401) return "authentication_failed";
  if (status === 403) return "authorization_or_key_type_mismatch";
  if (status === 404) return "route_or_header_behavior_not_available";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status < 600) return "provider_error";
  return "unexpected_status";
}

/**
 * Convert Anthropic's fractional-cent decimal string to a USD decimal without
 * ever passing through IEEE-754 binary floating point.
 */
export function decimalCentsToUsd(cents: string): string {
  if (!PLAIN_DECIMAL.test(cents)) {
    throw new Error("decimal cents must use plain decimal notation");
  }
  const negative = cents.startsWith("-");
  const unsigned = negative ? cents.slice(1) : cents;
  const [whole, fraction = ""] = unsigned.split(".");
  const scale = fraction.length;
  const scaledCents = BigInt(`${whole}${fraction}`);
  const usdScale = scale + 2;
  const digits = scaledCents.toString().padStart(usdScale + 1, "0");
  const integerPart = digits.slice(0, -usdScale);
  const fractionalPart = digits.slice(-usdScale);
  const sign = negative && scaledCents !== 0n ? "-" : "";
  return `${sign}${integerPart}.${fractionalPart}`;
}

export function opaqueNextPage(value: unknown): string | null {
  return isRecord(value) && typeof value.next_page === "string"
    ? value.next_page
    : null;
}

export function adminLastId(value: unknown): string | null {
  return isRecord(value) && typeof value.last_id === "string"
    ? value.last_id
    : null;
}

export function responseHasMore(value: unknown): boolean {
  return isRecord(value) && value.has_more === true;
}

export function inviteId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}

export function organizationId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}
