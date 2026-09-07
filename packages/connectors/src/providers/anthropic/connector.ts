import type {
  ConnectorCallObservationSession,
  ConnectorOperation,
} from "../../connector-call-observation.js";
import type {
  ConnectorCapability,
  SyncInput,
  VendorConnector,
} from "../../contracts.js";
import { validateProvisionInstruction } from "../../dispatch.js";
import type { AnthropicCredentialCandidate } from "./credentials.js";
import { createAnthropicConnectorObservationBridge } from "./observation.js";
import {
  type AnthropicClock,
  type AnthropicRateLimiter,
  type AnthropicSleep,
} from "./rate-limiter.js";
import type { AnthropicTransport } from "./request.js";
import { createAnthropicRequestExecutor as createRequestExecutor } from "./request.js";

export type AnthropicConnectorDependencies = Readonly<{
  credentialsFor(vendorAccountId: string): Promise<readonly AnthropicCredentialCandidate[]>;
  observationSessionFor(input: Readonly<{
    vendorAccountId: string;
    requestId: string | null;
    operation: ConnectorOperation;
  }>): Promise<ConnectorCallObservationSession>;
  requestDependencies: Readonly<{
    clock: AnthropicClock;
    sleep: AnthropicSleep;
    limiter: AnthropicRateLimiter;
    transport: AnthropicTransport;
  }>;
}>;

type ProviderFailure = Readonly<{
  ok: false;
  code: "provider_error";
  retryable: boolean;
  raw: null;
}>;

type IdPage<T> = Readonly<{
  data: readonly T[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}>;

type OpaquePage<T> = Readonly<{
  data: readonly T[];
  next_page: string | null;
}>;

type Member = Readonly<{ type: "user"; id: string; name: string; email: string | null }>;
type Invitation = Readonly<{ type: "invite"; id: string; email: string | null; status: string }>;
type AnalyticsUser = Readonly<{ user_id: string; email: string | null }>;
type ActivitySummary = Readonly<{
  date: string;
  active_users: number;
  conversations: number;
}>;
type UserUsage = Readonly<{
  user_id: string;
  email: string | null;
  input_tokens: string;
  output_tokens: string;
}>;
type CostResult = Readonly<{ amount: string; list_amount: string; currency: "USD" }>;
type UserCost = Readonly<{
  user_id: string;
  email: string | null;
  results: readonly CostResult[];
}>;

const capabilities = Object.freeze([
  "provision", "deprovision", "syncMembers", "syncActivity", "syncCost",
] as const) satisfies readonly ConnectorCapability[];
const plainDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$|^-(?:(?:[1-9]\d*)(?:\.\d+)?|0\.\d*[1-9]\d*)$/;
const plainUnsignedDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function providerFailure(retryable = false): ProviderFailure {
  return Object.freeze({ ok: false, code: "provider_error", retryable, raw: null });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function success<T>(value: T): Readonly<{ ok: true; value: T; raw: null }> {
  return Object.freeze({ ok: true, value: deepFreeze(value), raw: null });
}

function immutableCapabilities(): ReadonlySet<ConnectorCapability> {
  let view: ReadonlySet<ConnectorCapability>;
  view = Object.freeze({
    get size() { return capabilities.length; },
    has(value: ConnectorCapability) { return capabilities.includes(value); },
    entries() {
      return capabilities.map(
        (value): [ConnectorCapability, ConnectorCapability] => [value, value],
      ).values();
    },
    keys() { return capabilities.values(); },
    values() { return capabilities.values(); },
    forEach(
      callback: (value: ConnectorCapability, key: ConnectorCapability, set: ReadonlySet<ConnectorCapability>) => void,
      thisArg?: unknown,
    ) {
      for (const value of capabilities) callback.call(thisArg, value, value, view);
    },
    [Symbol.iterator]() { return capabilities.values(); },
  });
  return view;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ? value as Record<string, unknown>
    : null;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const candidate = record(value);
  if (!candidate) return null;
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? candidate
    : null;
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function wellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function opaqueToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && wellFormedUtf16(value);
}

function usableEmail(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !emailPattern.test(value) || value !== value.trim()) return undefined;
  return value.toLowerCase();
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseMember(value: unknown): Member | null {
  const item = exact(value, ["type", "id", "name", "email"]);
  if (!item || item.type !== "user" || !opaqueToken(item.id) || !nonblank(item.name)) return null;
  const email = usableEmail(item.email);
  return email === undefined ? null : { type: "user", id: item.id, name: item.name, email };
}

function parseInvitation(value: unknown): Invitation | null {
  const item = exact(value, ["type", "id", "email", "status"]);
  if (!item || item.type !== "invite" || !opaqueToken(item.id) || !nonblank(item.status)) return null;
  const email = usableEmail(item.email);
  return email === undefined ? null : { type: "invite", id: item.id, email, status: item.status };
}

function parseAnalyticsUser(value: unknown): AnalyticsUser | null {
  const item = exact(value, ["user_id", "email"]);
  if (!item || !opaqueToken(item.user_id)) return null;
  const email = usableEmail(item.email);
  return email === undefined ? null : { user_id: item.user_id, email };
}

function parseSummary(value: unknown): ActivitySummary | null {
  const item = exact(value, ["date", "active_users", "conversations"]);
  if (
    !item || !validDate(item.date)
    || !Number.isSafeInteger(item.active_users) || (item.active_users as number) < 0
    || !Number.isSafeInteger(item.conversations) || (item.conversations as number) < 0
  ) return null;
  return {
    date: item.date,
    active_users: item.active_users as number,
    conversations: item.conversations as number,
  };
}

function parseUsage(value: unknown): UserUsage | null {
  const item = exact(value, ["user_id", "email", "input_tokens", "output_tokens"]);
  if (
    !item || !opaqueToken(item.user_id) || typeof item.input_tokens !== "string"
    || !plainUnsignedDecimal.test(item.input_tokens) || typeof item.output_tokens !== "string"
    || !plainUnsignedDecimal.test(item.output_tokens)
  ) return null;
  const email = usableEmail(item.email);
  return email === undefined ? null : {
    user_id: item.user_id, email, input_tokens: item.input_tokens, output_tokens: item.output_tokens,
  };
}

function parseCostResult(value: unknown): CostResult | null {
  const item = exact(value, ["amount", "list_amount", "currency"]);
  if (
    !item || typeof item.amount !== "string" || typeof item.list_amount !== "string"
    || item.currency !== "USD" || !canonicalDecimal(item.amount) || !canonicalDecimal(item.list_amount)
  ) return null;
  return { amount: item.amount, list_amount: item.list_amount, currency: "USD" };
}

function parseCost(value: unknown): UserCost | null {
  const item = exact(value, ["user_id", "email", "results"]);
  if (
    !item || !opaqueToken(item.user_id) || !Array.isArray(item.results) || item.results.length === 0
  ) return null;
  const email = usableEmail(item.email);
  const results = item.results.map(parseCostResult);
  return email === undefined || results.some((result) => result === null) ? null : {
    user_id: item.user_id,
    email,
    results: results as CostResult[],
  };
}

function parseIdPage<T>(value: unknown, parser: (item: unknown) => T | null): IdPage<T> | null {
  const page = exact(value, ["data", "has_more", "first_id", "last_id"]);
  if (
    !page || !Array.isArray(page.data) || typeof page.has_more !== "boolean"
    || !(page.first_id === null || nonblank(page.first_id))
    || !(page.last_id === null || nonblank(page.last_id))
  ) return null;
  const data = page.data.map(parser);
  return data.some((item) => item === null) ? null : {
    data: data as T[], has_more: page.has_more, first_id: page.first_id, last_id: page.last_id,
  };
}

function parseOpaquePage<T>(value: unknown, parser: (item: unknown) => T | null): OpaquePage<T> | null {
  const page = exact(value, ["data", "next_page"]);
  if (!page || !Array.isArray(page.data) || !(page.next_page === null || nonblank(page.next_page))) return null;
  const data = page.data.map(parser);
  return data.some((item) => item === null) ? null : { data: data as T[], next_page: page.next_page };
}

function canonicalDecimal(value: string): boolean {
  if (!plainDecimal.test(value) || value.length > 80) return false;
  if (value.startsWith("-")) {
    return /[1-9]/.test(value);
  }
  return true;
}

function decimalParts(value: string): { negative: boolean; digits: string; scale: number } {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  return { negative, digits: `${whole}${fraction}`, scale: fraction.length };
}

function centsToUsd(value: string): string {
  if (!canonicalDecimal(value)) throw new Error("Invalid Anthropic cost decimal");
  const { negative, digits, scale } = decimalParts(value);
  const absolute = BigInt(digits);
  const usdScale = scale + 2;
  const padded = absolute.toString().padStart(usdScale + 1, "0");
  return `${negative ? "-" : ""}${padded.slice(0, -usdScale)}.${padded.slice(-usdScale)}`;
}

function addDecimals(values: readonly string[]): string {
  const parsed = values.map(decimalParts);
  const scale = Math.max(...parsed.map((item) => item.scale));
  const total = parsed.reduce((sum, item) => {
    const signed = BigInt(item.digits) * 10n ** BigInt(scale - item.scale);
    return sum + (item.negative ? -signed : signed);
  }, 0n);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const cents = scale === 0
    ? `${negative ? "-" : ""}${digits}`
    : `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return centsToUsd(cents);
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  const essence = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (essence !== "application/json") {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Invalid Anthropic response media type");
  }
  return response.json();
}

type OperationContext = Readonly<{
  credentials: readonly AnthropicCredentialCandidate[];
  execute: ReturnType<typeof createRequestExecutor>;
}>;

export function createAnthropicConnector(dependencies: AnthropicConnectorDependencies): VendorConnector {
  async function context(
    vendorAccountId: string,
    requestId: string | null,
    operation: ConnectorOperation,
  ): Promise<OperationContext> {
    const credentials = await dependencies.credentialsFor(vendorAccountId);
    const session = await dependencies.observationSessionFor({ vendorAccountId, requestId, operation });
    return {
      credentials,
      execute: createRequestExecutor({
        ...dependencies.requestDependencies,
        observe: createAnthropicConnectorObservationBridge(session),
      }),
    };
  }

  async function request(
    operation: OperationContext,
    input: Parameters<OperationContext["execute"]>[0],
  ): Promise<{ ok: true; body: unknown } | ProviderFailure> {
    const result = await operation.execute(input);
    if (!result.ok) return providerFailure(result.retryable);
    try {
      return { ok: true, body: await responseBody(result.response) };
    } catch {
      return providerFailure();
    }
  }

  async function idPages<T>(
    operation: OperationContext,
    endpoint: "members" | "invites",
    vendorAccountId: string,
    parser: (item: unknown) => T | null,
  ): Promise<{ ok: true; data: T[] } | ProviderFailure> {
    const data: T[] = [];
    const seen = new Set<string>();
    let continuation: string | undefined;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
      const pageResult = await request(operation, {
        endpoint, vendorAccountId, credentials: operation.credentials,
        query: continuation === undefined ? undefined : { continuation: { kind: "after_id", value: continuation } },
      });
      if (!pageResult.ok) return pageResult;
      const page = parseIdPage(pageResult.body, parser);
      if (!page) return providerFailure();
      data.push(...page.data);
      if (!page.has_more) return { ok: true, data };
      if (pageNumber === 100 || page.last_id === null || seen.has(page.last_id)) return providerFailure();
      seen.add(page.last_id);
      continuation = page.last_id;
    }
    return providerFailure();
  }

  async function opaquePages<T>(
    operation: OperationContext,
    endpoint: "analytics_users" | "user_usage_report" | "user_cost_report",
    vendorAccountId: string,
    observedOn: string,
    parser: (item: unknown) => T | null,
  ): Promise<{ ok: true; data: T[] } | ProviderFailure> {
    const data: T[] = [];
    const seen = new Set<string>();
    let continuation: string | undefined;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
      const pageResult = await request(operation, {
        endpoint, vendorAccountId, credentials: operation.credentials,
        query: {
          observedOn,
          continuation: continuation === undefined ? undefined : { kind: "page", value: continuation },
        },
      });
      if (!pageResult.ok) return pageResult;
      const page = parseOpaquePage(pageResult.body, parser);
      if (!page) return providerFailure();
      data.push(...page.data);
      if (page.next_page === null) return { ok: true, data };
      if (pageNumber === 100 || seen.has(page.next_page)) return providerFailure();
      seen.add(page.next_page);
      continuation = page.next_page;
    }
    return providerFailure();
  }

  function syncDate(input: SyncInput): string {
    if (!(input.observedAt instanceof Date) || !Number.isFinite(input.observedAt.getTime())) {
      throw new Error("Invalid Anthropic sync observedAt");
    }
    return input.observedAt.toISOString().slice(0, 10);
  }

  const connector: VendorConnector = {
    capabilities: immutableCapabilities,
    async provision(input) {
      validateProvisionInstruction(input);
      const operation = await context(input.vendorAccountId, input.requestId, "provision");
      const result = await request(operation, {
        endpoint: "create_invite", vendorAccountId: input.vendorAccountId,
        credentials: operation.credentials, body: { email: input.personEmail, role: "user" },
      });
      if (!result.ok) return result;
      const invitation = parseInvitation(result.body);
      return invitation ? success({ vendorRef: invitation.id }) : providerFailure();
    },
    async deprovision(input) {
      validateProvisionInstruction(input);
      const operation = await context(input.vendorAccountId, input.requestId, "deprovision");
      const members = await idPages(operation, "members", input.vendorAccountId, parseMember);
      if (!members.ok) return members;
      const invites = await idPages(operation, "invites", input.vendorAccountId, parseInvitation);
      if (!invites.ok) return invites;
      const target = input.personEmail.toLowerCase();
      const matches = [
        ...members.data.filter(({ email }) => email === target).map((item) => ({ endpoint: "delete_member" as const, id: item.id })),
        ...invites.data.filter(({ email }) => email === target).map((item) => ({ endpoint: "delete_invite" as const, id: item.id })),
      ];
      if (matches.length !== 1) return providerFailure();
      const match = matches[0]!;
      const deleted = await operation.execute({
        endpoint: match.endpoint, parameters: { resourceId: match.id },
        vendorAccountId: input.vendorAccountId, credentials: operation.credentials,
      });
      return deleted.ok ? success({ vendorRef: match.id }) : providerFailure(deleted.retryable);
    },
    async syncMembers(input) {
      syncDate(input);
      const operation = await context(input.vendorAccountId, null, "sync_members");
      const members = await idPages(operation, "members", input.vendorAccountId, parseMember);
      if (!members.ok) return members;
      const invites = await idPages(operation, "invites", input.vendorAccountId, parseInvitation);
      if (!invites.ok) return invites;
      const normalized = [
        ...members.data.filter((item): item is Member & { email: string } => item.email !== null)
          .map(({ email }) => ({ email, active: true })),
        ...invites.data.filter((item): item is Invitation & { email: string } => item.email !== null && item.status === "pending")
          .map(({ email }) => ({ email, active: false })),
      ];
      if (new Set(normalized.map(({ email }) => email)).size !== normalized.length) return providerFailure();
      return success({ members: normalized });
    },
    async syncActivity(input) {
      const observedOn = syncDate(input);
      const operation = await context(input.vendorAccountId, null, "sync_activity");
      const users = await opaquePages(operation, "analytics_users", input.vendorAccountId, observedOn, parseAnalyticsUser);
      if (!users.ok) return users;
      const byId = new Map<string, string | null>();
      const userEmails = new Set<string>();
      for (const user of users.data) {
        if (byId.has(user.user_id)) return providerFailure();
        if (user.email !== null && userEmails.has(user.email)) return providerFailure();
        byId.set(user.user_id, user.email);
        if (user.email !== null) userEmails.add(user.email);
      }
      const summariesResult = await request(operation, {
        endpoint: "analytics_summaries", vendorAccountId: input.vendorAccountId,
        credentials: operation.credentials, query: { observedOn },
      });
      if (!summariesResult.ok) return summariesResult;
      const envelope = exact(summariesResult.body, ["summaries"]);
      if (!envelope || !Array.isArray(envelope.summaries)) return providerFailure();
      const summaries = envelope.summaries.map(parseSummary);
      if (summaries.some((item) => item === null)) return providerFailure();
      if (summaries.length !== 1 || summaries[0]!.date !== observedOn) return providerFailure();
      const summary = summaries[0]!;
      const records = [...byId.values()].filter((email): email is string => email !== null)
        .map((email) => ({
          email,
          activityDate: observedOn,
          counters: { activeUsers: summary.active_users, conversations: summary.conversations },
        }));
      return success({ records });
    },
    async syncCost(input) {
      const observedOn = syncDate(input);
      const operation = await context(input.vendorAccountId, null, "sync_cost");
      const usages = await opaquePages(operation, "user_usage_report", input.vendorAccountId, observedOn, parseUsage);
      if (!usages.ok) return usages;
      const byId = new Map<string, string | null>();
      const usageEmails = new Set<string>();
      for (const usageItem of usages.data) {
        if (byId.has(usageItem.user_id)) return providerFailure();
        if (usageItem.email !== null && usageEmails.has(usageItem.email)) return providerFailure();
        byId.set(usageItem.user_id, usageItem.email);
        if (usageItem.email !== null) usageEmails.add(usageItem.email);
      }
      const costs = await opaquePages(operation, "user_cost_report", input.vendorAccountId, observedOn, parseCost);
      if (!costs.ok) return costs;
      const costIds = new Set<string>();
      const costEmails = new Set<string>();
      const records = [];
      for (const costItem of costs.data) {
        if (costIds.has(costItem.user_id) || !byId.has(costItem.user_id)) return providerFailure();
        costIds.add(costItem.user_id);
        if (costItem.email !== null && costEmails.has(costItem.email)) return providerFailure();
        if (costItem.email !== null) costEmails.add(costItem.email);
        const usageEmail = byId.get(costItem.user_id)!;
        if (costItem.email !== null && (usageEmail === null || costItem.email !== usageEmail)) {
          return providerFailure();
        }
        const email = usageEmail;
        if (email) {
          let amountUsd: string;
          try {
            amountUsd = addDecimals(costItem.results.map(({ amount }) => amount));
          } catch {
            return providerFailure();
          }
          records.push({ email, costDate: observedOn, amountUsd });
        }
      }
      return success({ records });
    },
  };
  return Object.freeze(connector);
}
