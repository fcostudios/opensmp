import {
  assertJsonValue,
  isConnectorFailureCode,
  isMemberPageStream,
  type ActivitySnapshot,
  type ConnectorCapability,
  type ConnectorResult,
  type CostSnapshot,
  type DeprovisionInput,
  type DeprovisionResult,
  type MemberPageCursor,
  type MemberPageResume,
  type MemberPageSnapshot,
  type LegacyVendorConnector,
  type MemberSnapshot,
  type ProvisionInput,
  type ProvisionResult,
  type SyncMemberPageInput,
  type SyncInput,
  type VendorConnector,
} from "./contracts.js";

export type ConnectorProtocol = "none" | "rest" | "scim";
const protocols = new Set<ConnectorProtocol>(["none", "rest", "scim"]);
const unsafeInstructionCharacter =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Bidi_Control}]/u;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function frozenSet<T>(values: Iterable<T>): ReadonlySet<T> {
  const set = new Set(values);
  const immutable = () => {
    throw new TypeError("Connector capabilities are immutable");
  };
  Object.defineProperties(set, {
    add: { value: immutable },
    delete: { value: immutable },
    clear: { value: immutable },
  });
  return Object.freeze(set);
}

function protocol(value: unknown): ConnectorProtocol {
  if (typeof value !== "string" || !protocols.has(value as ConnectorProtocol)) {
    throw new Error(`Unsupported connector protocol: ${String(value)}`);
  }
  return value as ConnectorProtocol;
}

export function validateProvisionInstruction(input: ProvisionInput): void {
  for (const field of [
    "requestId",
    "vendorAccountId",
    "personEmail",
    "licenseTypeName",
  ] as const) {
    validateInstructionValue(field, input[field]);
  }
}

function validateInstructionValue(field: string, value: string): void {
  if (
    value.trim().length === 0 ||
    unsafeInstructionCharacter.test(value) ||
    (["requestId", "vendorAccountId", "personId", "licenseId"].includes(field) &&
      !identifier.test(value)) ||
    (field === "personEmail" && !email.test(value))
  ) {
    throw new Error(`Invalid connector instruction input: ${field}`);
  }
}

function unsupported(
  checklistSteps: readonly string[],
): ConnectorResult<never> {
  return Object.freeze({
    ok: false as const,
    code: "unsupported" as const,
    checklistSteps: Object.freeze([...checklistSteps]),
  });
}

export type ManualChecklistOperation = "provision" | "deprovision";
export type ManualChecklistEntityIds = {
  readonly personId: string;
  readonly licenseId: string;
};
export type ManualChecklistAction = {
  readonly messageKey:
    | "connector.manual.open_vendor_console"
    | "connector.manual.invite_person"
    | "connector.manual.assign_license"
    | "connector.manual.remove_person"
    | "connector.manual.revoke_license"
    | "connector.manual.confirm_execution";
  readonly params: {
    readonly personEmail: string;
    readonly licenseTypeName: string;
  };
  readonly targets: {
    readonly requestId: string;
    readonly vendorAccountId: string;
    readonly personId: string;
    readonly licenseId: string;
  };
};

export function buildManualChecklistActions(
  operation: ManualChecklistOperation,
  input: ProvisionInput,
  result: Extract<ConnectorResult<unknown>, { ok: false; code: "unsupported" }>,
  entityIds: ManualChecklistEntityIds,
): readonly ManualChecklistAction[] {
  validateProvisionInstruction(input);
  validateInstructionValue("personId", entityIds.personId);
  validateInstructionValue("licenseId", entityIds.licenseId);
  if (result.checklistSteps.length === 0) {
    throw new Error("Invalid connector unsupported checklist: instruction");
  }
  const keys = operation === "provision"
    ? [
        "connector.manual.open_vendor_console",
        "connector.manual.invite_person",
        "connector.manual.assign_license",
        "connector.manual.confirm_execution",
      ] as const
    : [
        "connector.manual.open_vendor_console",
        "connector.manual.remove_person",
        "connector.manual.revoke_license",
        "connector.manual.confirm_execution",
      ] as const;
  const params = Object.freeze({
    personEmail: input.personEmail,
    licenseTypeName: input.licenseTypeName,
  });
  const targets = Object.freeze({
    requestId: input.requestId,
    vendorAccountId: input.vendorAccountId,
    personId: entityIds.personId,
    licenseId: entityIds.licenseId,
  });
  return Object.freeze(keys.map((messageKey) =>
    Object.freeze({ messageKey, params, targets })));
}

function createNoneConnector(): VendorConnector {
  return Object.freeze({
    capabilities: () => frozenSet<ConnectorCapability>([]),
    async provision(input: ProvisionInput) {
      validateProvisionInstruction(input);
      return unsupported([
          "Open the vendor administration console",
          `Invite ${input.personEmail}`,
          `Assign ${input.licenseTypeName}`,
          "Return to Ledger and confirm execution",
        ]);
    },
    async deprovision(input: DeprovisionInput) {
      validateProvisionInstruction(input);
      return unsupported([
          "Open the vendor administration console",
          `Remove ${input.personEmail}`,
          `Revoke ${input.licenseTypeName}`,
          "Return to Ledger and confirm execution",
        ]);
    },
    async syncMembers(_input: SyncInput) {
      return unsupported([]);
    },
    async syncMemberPage(_input: SyncMemberPageInput) {
      return unsupported([]);
    },
    async syncActivity(_input: SyncInput) {
      return unsupported([]);
    },
    async syncCost(_input: SyncInput) {
      return unsupported([]);
    },
  });
}

function validateResult<T>(
  result: ConnectorResult<T>,
  operation: "instruction" | "sync",
): ConnectorResult<T> {
  const hasRaw = (candidate: ConnectorResult<T>): candidate is Extract<
    ConnectorResult<T>,
    { raw: unknown }
  > => candidate.ok || isConnectorFailureCode(candidate.code);
  if (hasRaw(result)) {
    const raw = deepFreeze(assertJsonValue(result.raw, "raw"));
    if (result.ok) {
      return Object.freeze({
        ok: true,
        value: cloneAndFreeze(result.value),
        raw,
      });
    }
    if (result.code === "capacity_unavailable") {
      if (
        !isCapacityUnavailableRaw(raw)
        || result.retryable !== false
      ) {
        throw new Error("Invalid connector capacity unavailable result");
      }
      return Object.freeze({
        ok: false,
        code: "capacity_unavailable",
        retryable: false,
        raw,
      });
    }
    return Object.freeze({
      ok: false,
      code: "provider_error",
      retryable: result.retryable,
      raw,
    });
  } else if (
    (operation === "instruction" && result.checklistSteps.length === 0) ||
    (operation === "sync" && result.checklistSteps.length !== 0)
  ) {
    throw new Error(`Invalid connector unsupported checklist: ${operation}`);
  }
  return Object.freeze({
    ok: false,
    code: "unsupported",
    checklistSteps: Object.freeze([...result.checklistSteps]),
  });
}

function isCapacityUnavailableRaw(
  raw: unknown,
): raw is Readonly<{ failure_code: "capacity_unavailable" }> {
  return typeof raw === "object"
    && raw !== null
    && !Array.isArray(raw)
    && Object.keys(raw).length === 1
    && Object.hasOwn(raw, "failure_code")
    && (raw as { failure_code?: unknown }).failure_code === "capacity_unavailable";
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function cloneAndFreeze<T>(value: T): T {
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    throw new Error("Connector result is not cloneable");
  }
}

function memberPageCursor(value: unknown): MemberPageCursor {
  const invalid = (): never => {
    throw new Error("Invalid connector member page cursor");
  };
  try {
    assertJsonValue(value, "cursor");
    const json = value as Record<string, unknown>;
    if (
      !json || typeof json !== "object" || Array.isArray(json)
      || Object.keys(json).length !== 3
      || !Object.hasOwn(json, "stream")
      || !Object.hasOwn(json, "pageCount")
      || !Object.hasOwn(json, "memberSetSize")
      || !isMemberPageStream(json.stream)
      || typeof json.pageCount !== "number" || !Number.isSafeInteger(json.pageCount) || json.pageCount < 0 || json.pageCount >= 100
      || typeof json.memberSetSize !== "number" || !Number.isSafeInteger(json.memberSetSize) || json.memberSetSize < 0
    ) invalid();
    return json as MemberPageCursor;
  } catch {
    throw new Error("Invalid connector member page cursor");
  }
}

function memberPageResume(value: unknown, vendorAccountId?: string): MemberPageResume {
  const invalid = (): never => { throw new Error("Invalid connector member page resume"); };
  try {
    assertJsonValue(value, "resume");
    const json = value as Record<string, unknown>;
    const safeToken = (token: unknown) => typeof token === "string"
      && token.length > 0 && token.length <= 512
      && token === token.trim()
      && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Bidi_Control}]/u.test(token);
    if (!json || typeof json !== "object" || Array.isArray(json)
      || Object.keys(json).length !== 6 || typeof json.vendorAccountId !== "string"
      || (vendorAccountId !== undefined && json.vendorAccountId !== vendorAccountId)
      || !isMemberPageStream(json.stream)
      || !(json.continuation === null || safeToken(json.continuation))
      || !Array.isArray(json.seenContinuations) || !json.seenContinuations.every(safeToken)
      || new Set(json.seenContinuations).size !== json.seenContinuations.length
      || typeof json.pageCount !== "number" || !Number.isSafeInteger(json.pageCount) || json.pageCount < 1 || json.pageCount >= 100
      || typeof json.memberSetSize !== "number" || !Number.isSafeInteger(json.memberSetSize) || json.memberSetSize < 0
    ) invalid();
    return json as MemberPageResume;
  } catch { throw new Error("Invalid connector member page resume"); }
}

function validateMemberPageInput(input: SyncMemberPageInput): void {
  const cursor = input.cursor === null ? null : memberPageCursor(input.cursor);
  const resume = input.resume === undefined || input.resume === null
    ? null : memberPageResume(input.resume, input.vendorAccountId);
  if (
    (cursor === null) !== (resume === null)
    || (cursor !== null && resume !== null && (
      cursor.stream !== resume.stream
      || cursor.pageCount !== resume.pageCount
      || cursor.memberSetSize !== resume.memberSetSize
    ))
  ) {
    throw new Error("Invalid connector member page checkpoint");
  }
}

function validateMemberPageSnapshot(value: MemberPageSnapshot): MemberPageSnapshot {
  const invalid = (): never => {
    throw new Error("Invalid connector member page result");
  };
  try {
    assertJsonValue(value, "value");
    const json = value as unknown as Record<string, unknown>;
    if (
      !json || typeof json !== "object" || Array.isArray(json)
      || Object.keys(json).length !== 6
      || !Object.hasOwn(json, "members")
      || !Object.hasOwn(json, "cursor")
      || !Object.hasOwn(json, "resume")
      || !Object.hasOwn(json, "pageCount")
      || !Object.hasOwn(json, "memberSetSize")
      || !Object.hasOwn(json, "complete")
      || !Array.isArray(json.members)
      || !json.members.every((member) =>
        member !== null && typeof member === "object" && !Array.isArray(member)
        && Object.keys(member).length === 2
        && Object.hasOwn(member, "email") && Object.hasOwn(member, "active")
        && typeof member.email === "string" && email.test(member.email)
        && typeof member.active === "boolean",
      )
      || typeof json.pageCount !== "number" || !Number.isSafeInteger(json.pageCount) || json.pageCount < 1 || json.pageCount > 100
      || typeof json.memberSetSize !== "number" || !Number.isSafeInteger(json.memberSetSize) || json.memberSetSize < json.members.length
      || typeof json.complete !== "boolean"
      || (json.complete ? json.cursor !== null || json.resume !== null : json.cursor === null || json.resume === null)
    ) invalid();
    if (json.cursor !== null) {
      const cursor = memberPageCursor(json.cursor);
      if (cursor.pageCount !== json.pageCount || cursor.memberSetSize !== json.memberSetSize) invalid();
      const resume = memberPageResume(json.resume);
      if (
        cursor.stream !== resume.stream
        || cursor.pageCount !== resume.pageCount
        || cursor.memberSetSize !== resume.memberSetSize
      ) invalid();
    }
    return json as MemberPageSnapshot;
  } catch {
    throw new Error("Invalid connector member page result");
  }
}

function validatedConnector(connector: LegacyVendorConnector): VendorConnector {
  const capabilities = frozenSet<ConnectorCapability>(connector.capabilities());
  const provision = connector.provision.bind(connector);
  const deprovision = connector.deprovision.bind(connector);
  const syncMembers = connector.syncMembers.bind(connector);
  const syncMemberPage = connector.syncMemberPage?.bind(connector);
  const syncActivity = connector.syncActivity.bind(connector);
  const syncCost = connector.syncCost.bind(connector);
  return Object.freeze({
    capabilities: () => frozenSet<ConnectorCapability>(capabilities),
    async provision(input: ProvisionInput) {
      const result = await provision(input);
      return validateResult(result, "instruction");
    },
    async deprovision(input: DeprovisionInput) {
      const result = await deprovision(input);
      return validateResult(result, "instruction");
    },
    async syncMembers(input: SyncInput) {
      const result = await syncMembers(input);
      return validateResult(result, "sync");
    },
    async syncMemberPage(input: SyncMemberPageInput) {
      validateMemberPageInput(input);
      if (!syncMemberPage) return unsupported([]);
      const result = await syncMemberPage(input);
      const validated = validateResult(result, "sync");
      if (!validated.ok) return validated;
      return Object.freeze({
        ok: true as const,
        value: cloneAndFreeze(validateMemberPageSnapshot(validated.value)),
        raw: validated.raw,
      });
    },
    async syncActivity(input: SyncInput) {
      const result = await syncActivity(input);
      const validated = validateResult(result, "sync");
      if (validated.ok) {
        validated.value.records.forEach((record, index) =>
          assertJsonValue(record.counters, `value.records[${index}].counters`),
        );
      }
      return validated;
    },
    async syncCost(input: SyncInput) {
      const result = await syncCost(input);
      return validateResult(result, "sync");
    },
  });
}

export class ConnectorDispatcher {
  readonly #connectors = new Map<ConnectorProtocol, VendorConnector>();

  constructor() {
    this.#connectors.set("none", createNoneConnector());
  }

  register(candidate: ConnectorProtocol, connector: LegacyVendorConnector): void {
    const resolvedProtocol = protocol(candidate);
    if (this.#connectors.has(resolvedProtocol)) {
      throw new Error(`Connector protocol already registered: ${resolvedProtocol}`);
    }
    this.#connectors.set(resolvedProtocol, validatedConnector(connector));
  }

  forProtocol(candidate: ConnectorProtocol): VendorConnector {
    const resolvedProtocol = protocol(candidate);
    const connector = this.#connectors.get(resolvedProtocol);
    if (!connector) {
      throw new Error(`Connector protocol not registered: ${resolvedProtocol}`);
    }
    return connector;
  }
}

export function createConnectorDispatcher(
  input: Readonly<{ rest?: LegacyVendorConnector }> = {},
): ConnectorDispatcher {
  const dispatcher = new ConnectorDispatcher();
  if (input.rest) dispatcher.register("rest", input.rest);
  return dispatcher;
}
