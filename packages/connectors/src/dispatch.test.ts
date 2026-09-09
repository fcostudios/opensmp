import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import type {
  ConnectorCapability,
  ConnectorResult,
  ProvisionInput,
  VendorConnector,
} from "./contracts.js";
import {
  assertJsonValue,
  connectorFailureCodes,
  isConnectorFailureCode,
} from "./contracts.js";
import {
  buildManualChecklistActions,
  ConnectorDispatcher,
  createConnectorDispatcher,
} from "./dispatch.js";
import {
  analyzeSourceImports,
  discoverBoundarySources as discoverHardenedBoundarySources,
  scanRepositoryBoundary,
  scanBoundaryFile,
  type BoundaryTarget,
} from "./source-boundary.js";

const provisionInput: ProvisionInput = {
  requestId: "request-1",
  vendorAccountId: "vendor-account-1",
  personEmail: "person@example.com",
  licenseTypeName: "Standard",
};

function connectorWith(
  capability: ConnectorCapability,
): VendorConnector {
  const instructionUnsupported = async () =>
    ({
      ok: false,
      code: "unsupported",
      checklistSteps: ["Manual action"],
    }) as const;
  const syncUnsupported = async () =>
    ({
      ok: false,
      code: "unsupported",
      checklistSteps: [],
    }) as const;

  return {
    capabilities: () => new Set([capability]),
    provision: instructionUnsupported,
    deprovision: instructionUnsupported,
    syncMembers: syncUnsupported,
    syncMemberPage: syncUnsupported,
    syncActivity: syncUnsupported,
    syncCost: syncUnsupported,
  };
}

function validMemberPageValue() {
  return {
    members: [{ email: "member@example.test", active: true }],
    cursor: {
      stream: "members" as const,
      pageCount: 1,
      memberSetSize: 1,
    },
    resume: {
      vendorAccountId: "vendor-account-1",
      stream: "members" as const,
      continuation: "provider-continuation",
      seenContinuations: ["provider-continuation"],
      pageCount: 1,
      memberSetSize: 1,
    },
    pageCount: 1,
    memberSetSize: 1,
    complete: false,
  };
}

describe("none connector", () => {
  it("reports an exact empty capability set without exposing mutable state", () => {
    const connector = createConnectorDispatcher().forProtocol("none");
    const first = connector.capabilities();

    expect(first).toEqual(new Set());
    expect(connector.capabilities()).not.toBe(first);

    expect(() =>
      (first as Set<ConnectorCapability>).add("provision"),
    ).toThrow(TypeError);
    expect(connector.capabilities()).toEqual(new Set());
  });

  it("cannot be monkeypatched and is isolated per dispatcher", () => {
    const first = createConnectorDispatcher().forProtocol("none");
    const second = createConnectorDispatcher().forProtocol("none");

    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { provision: unknown }).provision = async () => ({
        ok: true,
        value: { vendorRef: "spoofed" },
        raw: null,
      });
    }).toThrow(TypeError);
  });

  it("returns the exact manual provisioning checklist", async () => {
    await expect(
      createConnectorDispatcher().forProtocol("none").provision(provisionInput),
    ).resolves.toEqual({
      ok: false,
      code: "unsupported",
      checklistSteps: [
        "Open the vendor administration console",
        "Invite person@example.com",
        "Assign Standard",
        "Return to Ledger and confirm execution",
      ],
    });
  });

  it("returns the exact manual removal checklist", async () => {
    await expect(
      createConnectorDispatcher().forProtocol("none").deprovision(provisionInput),
    ).resolves.toEqual({
      ok: false,
      code: "unsupported",
      checklistSteps: [
        "Open the vendor administration console",
        "Remove person@example.com",
        "Revoke Standard",
        "Return to Ledger and confirm execution",
      ],
    });
  });

  it("serializes the exact canonical unsupported result without hidden fields", async () => {
    const result = await createConnectorDispatcher()
      .forProtocol("none")
      .provision(provisionInput);

    expect(Object.keys(result)).toEqual(["ok", "code", "checklistSteps"]);
    expect(JSON.stringify(result)).toBe(
      '{"ok":false,"code":"unsupported","checklistSteps":["Open the vendor administration console","Invite person@example.com","Assign Standard","Return to Ledger and confirm execution"]}',
    );
  });

  it("builds localized structured actions separately with every target ID", async () => {
    const result = await createConnectorDispatcher()
      .forProtocol("none")
      .provision(provisionInput);
    if (!result.ok && result.code === "unsupported") {
      expect(buildManualChecklistActions(
        "provision",
        provisionInput,
        result,
        { personId: "person-1", licenseId: "license-1" },
      )[1]).toEqual({
        messageKey: "connector.manual.invite_person",
        params: {
          personEmail: "person@example.com",
          licenseTypeName: "Standard",
        },
        targets: {
          requestId: "request-1",
          vendorAccountId: "vendor-account-1",
          personId: "person-1",
          licenseId: "license-1",
        },
      });
    }
  });

  it.each([
    ["requestId", "request\n1"],
    ["vendorAccountId", "vendor\u0000account"],
    ["personEmail", "person@example.com\rspoof"],
    ["licenseTypeName", "Standard\u001b"],
    ["requestId", "   "],
    ["vendorAccountId", "vendor\u0085account"],
    ["personEmail", "not-an-email"],
    ["personEmail", "person@example.com\u2028spoof"],
    ["licenseTypeName", "Standard\u202Espoof"],
    ["licenseTypeName", "Standard\u2066spoof"],
    ["licenseTypeName", "\u2029"],
    ["personEmail", "person@example.com\u061Cspoof"],
    ["personEmail", "person@example.com\u200Espoof"],
    ["personEmail", "person@example.com\u200Fspoof"],
    ["licenseTypeName", "Standard\u061Cspoof"],
    ["licenseTypeName", "Standard\u200Espoof"],
    ["licenseTypeName", "Standard\u200Fspoof"],
  ] as const)("rejects spoofed %s instruction input", async (field, value) => {
    await expect(
      createConnectorDispatcher()
        .forProtocol("none")
        .provision({ ...provisionInput, [field]: value }),
    ).rejects.toThrowError(`Invalid connector instruction input: ${field}`);
  });

  it("rejects spoofed structured checklist IDs", async () => {
    const result = await createConnectorDispatcher()
      .forProtocol("none")
      .provision(provisionInput);
    if (!result.ok && result.code === "unsupported") {
      expect(() => buildManualChecklistActions(
        "provision",
        provisionInput,
        result,
        { personId: "person\nspoof", licenseId: "license-1" },
      )).toThrowError("Invalid connector instruction input: personId");
    }
  });

  it("routes every sync operation to manual ingestion without checklist steps", async () => {
    const connector = createConnectorDispatcher().forProtocol("none");
    const syncInput = {
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-07-27T12:00:00.000Z"),
    };
    const unsupported = {
      ok: false,
      code: "unsupported",
      checklistSteps: [],
    };

    await expect(connector.syncMembers(syncInput)).resolves.toEqual(unsupported);
    await expect(connector.syncMemberPage({ ...syncInput, cursor: null })).resolves.toEqual(unsupported);
    await expect(connector.syncActivity(syncInput)).resolves.toEqual(unsupported);
    await expect(connector.syncCost(syncInput)).resolves.toEqual(unsupported);
  });
});

describe("ConnectorDispatcher", () => {
  it("validates and freezes a JSON-safe resumable member page without exposing mutable state", async () => {
    const cursor = {
      stream: "members",
      pageCount: 1,
      memberSetSize: 1,
    } as const;
    const implementation = connectorWith("syncMembers");
    implementation.syncMemberPage = async () => ({
      ok: true,
      raw: null,
      value: {
        members: [{ email: "member@example.test", active: true }],
        cursor,
        resume: validMemberPageValue().resume,
        pageCount: 1,
        memberSetSize: 1,
        complete: false,
      },
    });
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");

    const result = await connector.syncMemberPage({
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-09-06T12:00:00.000Z"),
      cursor: null,
    });

    expect(result).toEqual({
      ok: true,
      raw: null,
      value: {
        members: [{ email: "member@example.test", active: true }],
        cursor,
        resume: validMemberPageValue().resume,
        pageCount: 1,
        memberSetSize: 1,
        complete: false,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.members)).toBe(true);
      expect(Object.isFrozen(result.value.cursor!)).toBe(true);
    }
  });

  it.each([
    ["malformed cursor", { stream: "members", continuation: 1, pageCount: 0, memberSetSize: 0 }],
    ["cyclic cursor", (() => {
      const cursor: Record<string, unknown> = { stream: "members", continuation: null, pageCount: 0, memberSetSize: 0 };
      cursor.self = cursor;
      return cursor;
    })()],
  ])("fails safely for a %s member-page cursor", async (_case, cursor) => {
    const connector = createConnectorDispatcher({ rest: connectorWith("syncMembers") })
      .forProtocol("rest");

    await expect(connector.syncMemberPage({
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-09-06T12:00:00.000Z"),
      cursor: cursor as never,
    })).rejects.toThrowError("Invalid connector member page cursor");
  });

  it.each([
    ["array", []],
    ["missing stream", { continuation: "provider-continuation", pageCount: 1, memberSetSize: 1 }],
    ["unknown stream", { stream: "activity", continuation: "provider-continuation", pageCount: 1, memberSetSize: 1 }],
    ["blank continuation", { stream: "members", continuation: "", pageCount: 1, memberSetSize: 1 }],
    ["wrong continuation", { stream: "members", continuation: false, pageCount: 1, memberSetSize: 1 }],
    ["member initial stream", { stream: "members", continuation: null, pageCount: 1, memberSetSize: 1 }],
    ["fractional page count", { stream: "members", continuation: "provider-continuation", pageCount: 1.5, memberSetSize: 1 }],
    ["negative page count", { stream: "members", continuation: "provider-continuation", pageCount: -1, memberSetSize: 1 }],
    ["hundredth continuation", { stream: "members", continuation: "provider-continuation", pageCount: 100, memberSetSize: 1 }],
    ["negative member count", { stream: "members", continuation: "provider-continuation", pageCount: 1, memberSetSize: -1 }],
    ["fractional member count", { stream: "members", continuation: "provider-continuation", pageCount: 1, memberSetSize: 1.5 }],
  ])("rejects each unsafe member-page continuation field: %s", async (_case, cursor) => {
    const connector = createConnectorDispatcher({ rest: connectorWith("syncMembers") })
      .forProtocol("rest");
    await expect(connector.syncMemberPage({
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-09-06T12:00:00.000Z"),
      cursor: cursor as never,
    })).rejects.toThrowError("Invalid connector member page cursor");
  });

  it.each([
    ["non-object", []],
    ["missing members", (() => { const value = validMemberPageValue(); delete (value as { members?: unknown }).members; return value; })()],
    ["extra field", { ...validMemberPageValue(), private: true }],
    ["non-array members", { ...validMemberPageValue(), members: {} }],
    ["malformed member", { ...validMemberPageValue(), members: [{ email: "not-an-email", active: true }] }],
    ["member extra field", { ...validMemberPageValue(), members: [{ email: "member@example.test", active: true, secret: "private" }] }],
    ["non-boolean active", { ...validMemberPageValue(), members: [{ email: "member@example.test", active: "yes" }] }],
    ["invalid page count", { ...validMemberPageValue(), pageCount: 0 }],
    ["page count over bound", { ...validMemberPageValue(), pageCount: 101 }],
    ["member size too small", { ...validMemberPageValue(), memberSetSize: 0 }],
    ["non-boolean complete", { ...validMemberPageValue(), complete: "no" }],
    ["complete with cursor", { ...validMemberPageValue(), complete: true }],
    ["incomplete without cursor", { ...validMemberPageValue(), cursor: null }],
    ["incomplete without resume", { ...validMemberPageValue(), resume: null }],
    ["complete with resume only", { ...validMemberPageValue(), complete: true, cursor: null }],
    ["resume missing vendor account", { ...validMemberPageValue(), resume: { stream: "members", continuation: "provider-continuation", seenContinuations: ["provider-continuation"] } }],
    ["resume wrong stream", { ...validMemberPageValue(), resume: { ...validMemberPageValue().resume, stream: "activity" } }],
    ["resume control token", { ...validMemberPageValue(), resume: { ...validMemberPageValue().resume, continuation: "provider\ncontinuation" } }],
    ["resume duplicate seen token", { ...validMemberPageValue(), resume: { ...validMemberPageValue().resume, seenContinuations: ["provider-continuation", "provider-continuation"] } }],
    ["resume malformed seen token", { ...validMemberPageValue(), resume: { ...validMemberPageValue().resume, seenContinuations: ["provider\u202Econtinuation"] } }],
    ["cursor count mismatch", { ...validMemberPageValue(), cursor: { ...validMemberPageValue().cursor, pageCount: 2 } }],
    ["cursor set-size mismatch", { ...validMemberPageValue(), cursor: { ...validMemberPageValue().cursor, memberSetSize: 2 } }],
    ["resume stream mismatch", { ...validMemberPageValue(), resume: { ...validMemberPageValue().resume, stream: "invitations" } }],
    ["resume page-count mismatch", { ...validMemberPageValue(), resume: { ...validMemberPageValue().resume, pageCount: 2 } }],
    ["resume set-size mismatch", { ...validMemberPageValue(), resume: { ...validMemberPageValue().resume, memberSetSize: 2 } }],
  ])("rejects each unsafe member-page result: %s", async (_case, value) => {
    const implementation = connectorWith("syncMembers");
    implementation.syncMemberPage = async () => ({ ok: true, raw: null, value } as never);
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");
    await expect(connector.syncMemberPage({
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-09-06T12:00:00.000Z"),
      cursor: null,
    })).rejects.toThrowError("Invalid connector member page result");
  });

  it.each([
    ["wrong account", { ...validMemberPageValue().resume, vendorAccountId: "other-account" }],
    ["bidi continuation", { ...validMemberPageValue().resume, continuation: "provider\u202Econtinuation" }],
    ["oversized continuation", { ...validMemberPageValue().resume, continuation: "x".repeat(513) }],
    ["duplicate cycle state", { ...validMemberPageValue().resume, seenContinuations: ["provider-continuation", "provider-continuation"] }],
    ["zero bound page count", { ...validMemberPageValue().resume, pageCount: 0 }],
    ["fractional page count", { ...validMemberPageValue().resume, pageCount: 1.5 }],
    ["page-count bound", { ...validMemberPageValue().resume, pageCount: 100 }],
    ["negative cumulative members", { ...validMemberPageValue().resume, memberSetSize: -1 }],
  ])("rejects unsafe account-bound resume state: %s", async (_case, resume) => {
    const connector = createConnectorDispatcher({ rest: connectorWith("syncMembers") }).forProtocol("rest");
    await expect(connector.syncMemberPage({
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-09-06T12:00:00.000Z"),
      cursor: null,
      resume: resume as never,
    })).rejects.toThrowError("Invalid connector member page resume");
  });

  it("rejects detached or recombined member-page checkpoints before invoking an adapter", async () => {
    // A cursor is public evidence while resume is account-bound secret state; either fragment alone must never restart paging.
    let pageCalls = 0;
    const implementation = connectorWith("syncMembers");
    implementation.syncMemberPage = async () => {
      pageCalls += 1;
      return { ok: true, raw: null, value: validMemberPageValue() };
    };
    const connector = createConnectorDispatcher({ rest: implementation }).forProtocol("rest");
    const input = {
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-09-06T12:00:00.000Z"),
    };
    const checkpoint = validMemberPageValue();

    for (const fragment of [
      { cursor: checkpoint.cursor },
      { cursor: checkpoint.cursor, resume: null },
      { cursor: null, resume: checkpoint.resume },
      { cursor: { ...checkpoint.cursor, stream: "invitations" }, resume: checkpoint.resume },
      { cursor: { ...checkpoint.cursor, pageCount: checkpoint.pageCount + 1 }, resume: checkpoint.resume },
      { cursor: { ...checkpoint.cursor, memberSetSize: checkpoint.memberSetSize + 1 }, resume: checkpoint.resume },
    ]) {
      await expect(connector.syncMemberPage({ ...input, ...fragment } as never))
        .rejects.toThrowError("Invalid connector member page checkpoint");
    }
    expect(pageCalls).toBe(0);
  });

  it("preserves an unsupported member-page result without attempting success validation", async () => {
    const connector = createConnectorDispatcher({ rest: connectorWith("syncMembers") })
      .forProtocol("rest");
    await expect(connector.syncMemberPage({
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-09-06T12:00:00.000Z"),
      cursor: null,
    })).resolves.toEqual({ ok: false, code: "unsupported", checklistSteps: [] });
  });

  it("registers a pre-page legacy adapter and supplies canonical unsupported paging", async () => {
    const legacy = connectorWith("syncMembers") as Omit<VendorConnector, "syncMemberPage">;
    delete (legacy as Partial<VendorConnector>).syncMemberPage;
    const connector = createConnectorDispatcher({ rest: legacy }).forProtocol("rest");
    await expect(connector.syncMemberPage({
      vendorAccountId: "vendor-account-1",
      observedAt: new Date("2026-09-06T12:00:00.000Z"),
      cursor: null,
    })).resolves.toEqual({ ok: false, code: "unsupported", checklistSteps: [] });
  });

  it("exports the exact immutable provider failure vocabulary", () => {
    expect(connectorFailureCodes).toEqual(["provider_error", "capacity_unavailable"]);
    expect(Object.isFrozen(connectorFailureCodes)).toBe(true);
    expect(() => (connectorFailureCodes as unknown as string[]).push("unknown"))
      .toThrow(TypeError);
    expect(isConnectorFailureCode("provider_error")).toBe(true);
    expect(isConnectorFailureCode("capacity_unavailable")).toBe(true);
    expect(isConnectorFailureCode("unsupported")).toBe(false);
    expect(isConnectorFailureCode(null)).toBe(false);
  });

  it("leaves rest unregistered when construction input is omitted", () => {
    // Mutation caught: default-registering rest would activate a network connector for existing callers.
    expect(() => createConnectorDispatcher().forProtocol("rest")).toThrowError(
      "Connector protocol not registered: rest",
    );
  });

  it("validates generic injected rest success and failure results", async () => {
    // Mutations caught: ignoring constructor injection, bypassing the wrapper,
    // or dropping retryability changes these generic neutral results.
    const implementation = connectorWith("provision");
    implementation.provision = async () => ({
      ok: true,
      value: { vendorRef: "remote-1" },
      raw: { request: "safe" },
    });
    implementation.deprovision = async () => ({
      ok: false,
      code: "provider_error",
      retryable: false,
      raw: null,
    });
    const connector = createConnectorDispatcher({ rest: implementation })
      .forProtocol("rest");

    await expect(connector.provision(provisionInput)).resolves.toEqual({
      ok: true,
      value: { vendorRef: "remote-1" },
      raw: { request: "safe" },
    });
    const failure = await connector.deprovision(provisionInput);
    expect(failure).toEqual({
      ok: false,
      code: "provider_error",
      retryable: false,
      raw: null,
    });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(connector).not.toBe(implementation);
  });

  it("accepts only the exact immutable capacity-unavailable result", async () => {
    const implementation = connectorWith("provision");
    implementation.provision = async () => ({
      ok: false,
      code: "capacity_unavailable",
      retryable: false,
      raw: { failure_code: "capacity_unavailable" },
    });
    const result = await createConnectorDispatcher({ rest: implementation })
      .forProtocol("rest")
      .provision(provisionInput);

    expect(result).toEqual({
      ok: false,
      code: "capacity_unavailable",
      retryable: false,
      raw: { failure_code: "capacity_unavailable" },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { raw: object }).raw)).toBe(true);
  });

  it.each([
    ["retryable", { failure_code: "capacity_unavailable" }, true],
    ["null raw", null, false],
    ["primitive raw", "capacity_unavailable", false],
    ["array raw", ["capacity_unavailable"], false],
    ["empty raw", {}, false],
    ["extra raw key", { failure_code: "capacity_unavailable", detail: "private" }, false],
    ["wrong raw code", { failure_code: "provider_error" }, false],
  ] as const)("rejects an inexact capacity result with %s", async (
    _case,
    raw,
    retryable,
  ) => {
    const implementation = connectorWith("provision");
    implementation.provision = async () => ({
      ok: false,
      code: "capacity_unavailable",
      retryable,
      raw,
    } as never);

    await expect(createConnectorDispatcher({ rest: implementation })
      .forProtocol("rest")
      .provision(provisionInput))
      .rejects.toThrowError("Invalid connector capacity unavailable result");
  });

  it.each(["rest", "scim"] as const)(
    "registers and resolves a future %s connector",
    (protocol) => {
      const dispatcher = createConnectorDispatcher();
      const connector = connectorWith("provision");

      dispatcher.register(protocol, connector);

      expect(dispatcher.forProtocol(protocol)).not.toBe(connector);
      expect(dispatcher.forProtocol(protocol).capabilities()).toEqual(
        new Set(["provision"]),
      );
    },
  );

  it("rejects duplicate registrations with a stable error", () => {
    const dispatcher = createConnectorDispatcher();
    dispatcher.register("rest", connectorWith("provision"));

    expect(() =>
      dispatcher.register("rest", connectorWith("syncMembers")),
    ).toThrowError("Connector protocol already registered: rest");
  });

  it("rejects unknown protocols with a stable error", () => {
    const dispatcher = new ConnectorDispatcher();

    expect(() => dispatcher.forProtocol("scim")).toThrowError(
      "Connector protocol not registered: scim",
    );
  });

  it("always seeds none and rejects arbitrary runtime protocols", () => {
    const dispatcher = new ConnectorDispatcher();

    expect(dispatcher.forProtocol("none").capabilities()).toEqual(new Set());
    expect(() =>
      dispatcher.forProtocol("anthropic" as never),
    ).toThrowError("Unsupported connector protocol: anthropic");
    expect(() =>
      dispatcher.register("claude" as never, connectorWith("provision")),
    ).toThrowError("Unsupported connector protocol: claude");
  });

  it("keeps registrations isolated between dispatcher instances", () => {
    const first = createConnectorDispatcher();
    const second = createConnectorDispatcher();
    first.register("rest", connectorWith("provision"));

    expect(() => second.forProtocol("rest")).toThrowError(
      "Connector protocol not registered: rest",
    );
  });

  it("snapshots capabilities and bound methods at registration", async () => {
    const capabilities = new Set<ConnectorCapability>(["provision"]);
    const connector = connectorWith("provision");
    connector.capabilities = () => capabilities;
    const dispatcher = createConnectorDispatcher();
    dispatcher.register("rest", connector);

    capabilities.add("syncCost");
    connector.capabilities = () => new Set(["syncMembers"]);
    connector.provision = async () => ({
      ok: true,
      value: { vendorRef: "mutated" },
      raw: null,
    });

    expect(dispatcher.forProtocol("rest").capabilities()).toEqual(
      new Set(["provision"]),
    );
    await expect(
      dispatcher.forProtocol("rest").provision(provisionInput),
    ).resolves.toEqual({
      ok: false,
      code: "unsupported",
      checklistSteps: ["Manual action"],
    });
  });
});

describe("JSON-safe connector results", () => {
  it("accepts a canonical connector implementation without extended result fields", () => {
    const canonical: VendorConnector = {
      capabilities: () => new Set(),
      provision: async () => ({
        ok: false,
        code: "unsupported",
        checklistSteps: ["Manual"],
      }),
      deprovision: async () => ({
        ok: false,
        code: "unsupported",
        checklistSteps: ["Manual"],
      }),
      syncMembers: async () => ({
        ok: false,
        code: "unsupported",
        checklistSteps: [],
      }),
      syncMemberPage: async () => ({
        ok: false,
        code: "unsupported",
        checklistSteps: [],
      }),
      syncActivity: async () => ({
        ok: true,
        value: {
          records: [{
            email: "person@example.com",
            activityDate: "2026-07-27",
            counters: undefined,
          }],
        },
        raw: new Date("2026-07-27T00:00:00Z"),
      }),
      syncCost: async () => ({
        ok: false,
        code: "unsupported",
        checklistSteps: [],
      }),
    };

    expect(canonical.capabilities()).toEqual(new Set());
  });

  it.each([
    1n,
    undefined,
    Symbol("unsafe"),
    () => "unsafe",
  ])("rejects non-JSON value %s", (value) => {
    expect(() => assertJsonValue(value, "raw")).toThrowError(
      "Connector JSON value is not JSON-safe: raw",
    );
  });

  it("rejects cyclic values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => assertJsonValue(cyclic, "raw")).toThrowError(
      "Connector JSON value is not JSON-safe: raw.self",
    );
  });

  it("accepts recursive JSON objects and arrays", () => {
    expect(
      assertJsonValue({ ok: true, nested: [null, "value", 2] }, "raw"),
    ).toEqual({ ok: true, nested: [null, "value", 2] });
  });

  it("rejects unsafe provider raw values before returning them", async () => {
    const dispatcher = createConnectorDispatcher();
    const connector = connectorWith("provision");
    connector.provision = async () =>
      ({
        ok: true,
        value: { vendorRef: "remote-1" },
        raw: 1n,
      }) as unknown as ConnectorResult<{ vendorRef: string | null }>;
    dispatcher.register("rest", connector);

    await expect(
      dispatcher.forProtocol("rest").provision(provisionInput),
    ).rejects.toThrowError("Connector JSON value is not JSON-safe: raw");
  });

  it("deep-clones and freezes provider results before returning them", async () => {
    const raw = { nested: { count: 1 } };
    const value = { vendorRef: "remote-1" };
    const connector = connectorWith("provision");
    connector.provision = async () => ({ ok: true, value, raw });
    const dispatcher = createConnectorDispatcher();
    dispatcher.register("rest", connector);

    const result = await dispatcher.forProtocol("rest").provision(provisionInput);
    raw.nested.count = 2;
    value.vendorRef = "mutated";

    expect(result).toEqual({
      ok: true,
      value: { vendorRef: "remote-1" },
      raw: { nested: { count: 1 } },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.raw)).toBe(true);
      expect(Object.isFrozen((result.raw as { nested: object }).nested)).toBe(true);
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });
});

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const connectorPackageRoot = resolve(import.meta.dirname, "..");
const boundaryTargets = [
  {
    label: "domain request-workflow",
    path: resolve(repositoryRoot, "packages/domain/src/request-workflow"),
    expectedPresence: "present",
  },
  {
    label: "web request-workflow",
    path: resolve(repositoryRoot, "apps/web/src/modules/request-workflow"),
    expectedPresence: "present",
  },
  {
    label: "org-registry register modules",
    path: resolve(repositoryRoot, "apps/web/src/modules/org-registry"),
    fileNamePattern: /^register.*\.tsx?$/,
    expectedPresence: "present",
  },
  {
    label: "future web register modules",
    path: resolve(repositoryRoot, "apps/web/src/modules/register"),
    expectedPresence: "present",
  },
  {
    label: "future domain telemetry",
    path: resolve(repositoryRoot, "packages/domain/src/telemetry"),
    expectedPresence: "future",
  },
  {
    label: "future web telemetry",
    path: resolve(repositoryRoot, "apps/web/src/modules/telemetry"),
    expectedPresence: "future",
  },
  {
    label: "future worker telemetry",
    path: resolve(repositoryRoot, "apps/worker/src/telemetry"),
    expectedPresence: "future",
  },
] as const;
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const providerPathPattern =
  /anthropic|claude/i;

async function sourceFilesUnder(path: string): Promise<string[]> {
  const metadata = await stat(path).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    },
  );
  if (!metadata) {
    return [];
  }
  if (metadata.isFile()) {
    return [path];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(path, entry.name);
      return entry.isDirectory() ? sourceFilesUnder(entryPath) : [entryPath];
    }),
  );
  return paths.flat();
}

function importedModuleSpecifiers(
  source: string,
  fileName = "fixture.ts",
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  function addStringLiteral(node: ts.Node | undefined): void {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) {
        addStringLiteral(node.argument.literal);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      addStringLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

async function discoveredBoundarySources(
  target: (typeof boundaryTargets)[number],
): Promise<string[]> {
  return discoverHardenedBoundarySources(target as BoundaryTarget);
}

function providerViolations(file: string, source: string): readonly string[] {
  return analyzeSourceImports(file, source).map(
    (violation) =>
      `${relative(repositoryRoot, file).replaceAll("\\", "/")} -> ${violation.specifier ?? violation.reason}`,
  );
}

function lintFixture(fileName: string, source: string) {
  return spawnSync(
    "pnpm",
    [
      "exec",
      "eslint",
      "--config",
      resolve(repositoryRoot, "eslint.provider-boundary.config.mjs"),
      "--no-warn-ignored",
      "--stdin",
      "--stdin-filename",
      fileName,
    ],
    {
      cwd: repositoryRoot,
      input: source,
      encoding: "utf8",
    },
  );
}

describe("provider import parser", () => {
  it("ignores comments and ordinary strings", () => {
    const source = `
      // import client from "@vendor/anthropicClient";
      const example = 'claudeClient';
    `;

    expect(importedModuleSpecifiers(source)).toEqual([]);
  });

  it("finds static, export, import-type, and dynamic module specifiers", () => {
    const source = `
      import client from "@vendor/anthropicClient";
      import type { Model } from "@vendor/claudeTypes";
      export { helper } from "./claudeClient";
      type Remote = import("@vendor/types").Remote;
      const lazy = import("./providers/anthropic");
    `;

    expect(importedModuleSpecifiers(source)).toEqual([
      "@vendor/anthropicClient",
      "@vendor/claudeTypes",
      "./claudeClient",
      "@vendor/types",
      "./providers/anthropic",
    ]);
  });

  it("allows the vendor-neutral connector interface", () => {
    expect(
      importedModuleSpecifiers('import type { VendorConnector } from "@smp/connectors";')
        .filter((specifier) => providerPathPattern.test(specifier)),
    ).toEqual([]);
  });
});

describe("hardened provider boundary scanner", () => {
  it("covers ESM, TypeScript, CommonJS, templates, and unverifiable dynamic forms", () => {
    const file = resolve(repositoryRoot, "apps/web/src/modules/request-workflow/fixture.mts");
    const violations = analyzeSourceImports(file, `
      import "@vendor/anthropicStatic";
      export { x } from "@vendor/claudeExport";
      import type { X } from "@vendor/anthropicTypes";
      import legacy = require("@vendor/claudeLegacy");
      const a = import(\`@vendor/anthropicDynamic\`);
      const b = require("@vendor/claudeRequire");
      const c = require.resolve(\`@vendor/anthropicResolve\`);
      const d = import(runtimePath);
      const e = require(runtimePath);
      const f = require.resolve(runtimePath);
    `);

    expect(violations.map(({ reason }) => reason)).toEqual([
      "provider_token",
      "provider_token",
      "provider_token",
      "provider_token",
      "provider_token",
      "provider_token",
      "provider_token",
      "unverifiable_dynamic_module",
      "unverifiable_dynamic_module",
      "unverifiable_dynamic_module",
    ]);
  });

  it("does not interpret comments or ordinary strings as modules", () => {
    const file = resolve(repositoryRoot, "apps/web/src/modules/request-workflow/fixture.ts");
    expect(analyzeSourceImports(file, `
      // require("@vendor/anthropicComment")
      const example = "import('@vendor/claudeString')";
    `)).toEqual([]);
  });

  it("resolves aliases and detects provider tokens in the resolved path", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "connector-boundary-"));
    try {
      await mkdir(resolve(fixtureRoot, "src/providers/anthropic"), { recursive: true });
      await writeFile(resolve(fixtureRoot, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@vendor/*": ["src/providers/anthropic/*"] },
        },
      }));
      await writeFile(
        resolve(fixtureRoot, "src/providers/anthropic/client.ts"),
        "export default {};",
      );
      const entry = resolve(fixtureRoot, "src/service.ts");
      await writeFile(entry, 'import client from "@vendor/client";');

      expect(await scanBoundaryFile(entry)).toMatchObject([
        { reason: "resolved_provider_path", specifier: "@vendor/client" },
      ]);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("discovers every supported extension and rejects symlinked sources", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "connector-boundary-"));
    try {
      const sourceRoot = resolve(fixtureRoot, "sources");
      await mkdir(sourceRoot, { recursive: true });
      for (const extension of [
        ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs",
      ]) {
        await writeFile(
          resolve(sourceRoot, `source${extension}`),
          'import "@smp/connectors";',
        );
      }
      const target: BoundaryTarget = {
        label: "fixture",
        path: sourceRoot,
        expectedPresence: "present",
      };
      expect((await discoverHardenedBoundarySources(target)).length).toBe(8);

      const outside = resolve(fixtureRoot, "outside.ts");
      const linked = resolve(sourceRoot, "linked.ts");
      await writeFile(outside, 'import "@smp/connectors";');
      await symlink(outside, linked);
      await expect(discoverHardenedBoundarySources(target)).rejects.toThrow(
        "Boundary source symlink is not allowed:",
      );
      expect(await scanBoundaryFile(linked)).toMatchObject([
        { reason: "symlink" },
      ]);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("scans adversarial provider imports repo-wide outside workflow modules", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "connector-repository-"));
    try {
      const arbitrary = resolve(fixtureRoot, "apps/web/src/modules/arbitrary");
      await mkdir(arbitrary, { recursive: true });
      await writeFile(resolve(arbitrary, "esm.mts"), 'import "@vendor/Anthropic";');
      await writeFile(
        resolve(arbitrary, "legacy.cts"),
        'import client = require("@vendor/claude");',
      );
      await writeFile(
        resolve(arbitrary, "common.cjs"),
        'require.resolve("@vendor/anthropicClient");',
      );
      await writeFile(
        resolve(arbitrary, "dynamic.jsx"),
        'import(`@vendor/claudeClient`);',
      );
      await writeFile(
        resolve(arbitrary, "unverifiable.js"),
        "require(runtimeProvider);",
      );
      const adapter = resolve(
        fixtureRoot,
        "packages/connectors/src/providers/anthropic.ts",
      );
      await mkdir(resolve(adapter, ".."), { recursive: true });
      await writeFile(adapter, 'require("@vendor/anthropicClient");');
      const composition = resolve(
        fixtureRoot,
        "apps/worker/src/connector-composition.ts",
      );
      await mkdir(resolve(composition, ".."), { recursive: true });
      await writeFile(
        composition,
        'export { factory } from "@smp/connectors/providers/anthropic/connector";',
      );
      const probe = resolve(
        fixtureRoot,
        "scripts/probes/anthropic/fixture.js",
      );
      await mkdir(resolve(probe, ".."), { recursive: true });
      await writeFile(probe, 'import client from "@vendor/anthropicClient";');
      const probeNearPath = resolve(
        fixtureRoot,
        "scripts/probes-copy/anthropic/fixture.js",
      );
      await mkdir(resolve(probeNearPath, ".."), { recursive: true });
      await writeFile(probeNearPath, 'import client from "@vendor/anthropicClient";');

      const violations = await scanRepositoryBoundary(fixtureRoot);
      expect(violations.map(({ reason }) => reason).sort()).toEqual([
        "provider_token",
        "provider_token",
        "provider_token",
        "provider_token",
        "provider_token",
        "unverifiable_dynamic_module",
      ]);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("provider boundary ESLint enforcement", () => {
  it("rejects provider imports containing camelCase provider names", () => {
    const result = lintFixture(
      "apps/web/src/modules/request-workflow/fixture.js",
      'import client from "@vendor/anthropicClient";',
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("no-restricted-imports");
  });

  it("rejects CommonJS provider modules", () => {
    const result = lintFixture(
      "apps/web/src/modules/request-workflow/fixture.cjs",
      'const client = require("@vendor/ClaudeClient");',
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("no-restricted-modules");
  });

  it.each([
    "packages/connectors/src/providers/anthropic-client.js",
    "scripts/probes/anthropic/fixture.js",
  ])("allows the designated exception path %s", (fileName) => {
    const result = lintFixture(
      fileName,
      'import client from "@vendor/claudeClient";',
    );

    expect(result.status).toBe(0);
  });

  it("allows core imports from @smp/connectors", () => {
    const result = lintFixture(
      "apps/web/src/modules/request-workflow/fixture.js",
      'import { createConnectorDispatcher } from "@smp/connectors";',
    );

    expect(result.status).toBe(0);
  });

  it("allows only the explicit worker connector composition seam", () => {
    const result = lintFixture(
      "apps/worker/src/connector-composition.ts",
      'export { factory } from "@smp/connectors/providers/anthropic/connector";',
    );

    expect(result.status).toBe(0);
    const nearPath = lintFixture(
      "apps/worker/src/connector-composition-copy.ts",
      'export { factory } from "@smp/connectors/providers/anthropic/connector";',
    );
    expect(nearPath.status).toBe(1);
    expect(nearPath.stdout).toContain("no-restricted-imports");
  });
});

describe("vendor-neutral core source boundary", () => {
  it.each(boundaryTargets)(
    "enumerates the $label source boundary explicitly",
    async ({ path, expectedPresence }) => {
      const candidates = await sourceFilesUnder(path);
      expect(candidates.length > 0).toBe(expectedPresence === "present");
    },
  );

  it("discovers every real import-bearing request-workflow and register source", async () => {
    const discovered = (
      await Promise.all(boundaryTargets.map(discoveredBoundarySources))
    )
      .flat()
      .map((file) => relative(repositoryRoot, file))
      .sort();

    expect(discovered).toEqual([
      "apps/web/src/modules/org-registry/register-backfill-transaction.ts",
      "apps/web/src/modules/org-registry/register-backfill.ts",
      "apps/web/src/modules/register/actions.ts",
      "apps/web/src/modules/register/export-boundary.ts",
      "apps/web/src/modules/register/repository.ts",
      "apps/web/src/modules/register/server-actions.ts",
      "apps/web/src/modules/request-workflow/actions/checklist-action-production-dependencies.ts",
      "apps/web/src/modules/request-workflow/actions/checklist-action-transaction.ts",
      "apps/web/src/modules/request-workflow/actions/checklist.ts",
      "apps/web/src/modules/request-workflow/actions/decide-request-policy.ts",
      "apps/web/src/modules/request-workflow/actions/decide-request.ts",
      "apps/web/src/modules/request-workflow/actions/retry-provisioning-action-production.ts",
      "apps/web/src/modules/request-workflow/actions/retry-provisioning-action.ts",
      "apps/web/src/modules/request-workflow/actions/retry-provisioning.ts",
      "apps/web/src/modules/request-workflow/actions/submit-request-policy.ts",
      "apps/web/src/modules/request-workflow/actions/submit-request.ts",
      "apps/web/src/modules/request-workflow/approval-repository.ts",
      "apps/web/src/modules/request-workflow/approval/ecuador-calendar.ts",
      "apps/web/src/modules/request-workflow/approval/repository.ts",
      "apps/web/src/modules/request-workflow/lifecycle-notifications.ts",
      "apps/web/src/modules/request-workflow/member-sync-checklist-observation.ts",
      "apps/web/src/modules/request-workflow/orchestration-contract.ts",
      "apps/web/src/modules/request-workflow/orchestration.ts",
      "apps/web/src/modules/request-workflow/provisioning-service.ts",
      "apps/web/src/modules/request-workflow/read-repository.ts",
      "apps/web/src/modules/request-workflow/repository.ts",
      "apps/web/src/modules/request-workflow/request-detail-decision-policy.ts",
      "apps/web/src/modules/request-workflow/service.ts",
      "apps/web/src/modules/request-workflow/transition-core.ts",
      "packages/domain/src/request-workflow/business-time.ts",
    ]);
  });

  it.each([
    {
      file: "apps/web/src/modules/request-workflow/service.ts",
      specifier: "@vendor/anthropicClient",
    },
    {
      file: "apps/web/src/modules/org-registry/register-backfill.ts",
      specifier: "./providers/claudeClient",
    },
  ])("detects an injected provider import in $file", ({ file, specifier }) => {
    const absoluteFile = resolve(repositoryRoot, file);

    expect(
      providerViolations(
        absoluteFile,
        `import provider from "${specifier}";`,
      ),
    ).toEqual([`${file} -> ${specifier}`]);
  });

  it("contains no provider-specific imports in every present boundary", async () => {
    const violations: string[] = [];

    for (const target of boundaryTargets) {
      const candidates = await discoveredBoundarySources(target);
      for (const file of candidates) {
        const source = await readFile(file, "utf8");
        violations.push(...providerViolations(file, source));
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("connector source-package build", () => {
  it("type-checks consecutively without dist or tsbuildinfo side effects", async () => {
    const artifactSnapshot = async () =>
      [
        ...(await readdir(connectorPackageRoot))
          .filter((file) => file.endsWith(".tsbuildinfo")),
        ...(await sourceFilesUnder(resolve(connectorPackageRoot, "dist")))
          .map((file) =>
            relative(connectorPackageRoot, file).replaceAll("\\", "/")),
      ].sort();
    const before = await artifactSnapshot();

    const first = spawnSync("pnpm", ["run", "build"], {
      cwd: connectorPackageRoot,
      encoding: "utf8",
    });
    expect(first.status).toBe(0);

    const second = spawnSync("pnpm", ["run", "build"], {
      cwd: connectorPackageRoot,
      encoding: "utf8",
    });
    expect(second.status).toBe(0);

    expect(await artifactSnapshot()).toEqual(before);
  });
});
