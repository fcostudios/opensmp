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
import { assertJsonValue } from "./contracts.js";
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
    syncActivity: syncUnsupported,
    syncCost: syncUnsupported,
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
    await expect(connector.syncActivity(syncInput)).resolves.toEqual(unsupported);
    await expect(connector.syncCost(syncInput)).resolves.toEqual(unsupported);
  });
});

describe("ConnectorDispatcher", () => {
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

      const violations = await scanRepositoryBoundary(fixtureRoot);
      expect(violations.map(({ reason }) => reason).sort()).toEqual([
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
      "apps/web/src/modules/request-workflow/actions/submit-request-policy.ts",
      "apps/web/src/modules/request-workflow/actions/submit-request.ts",
      "apps/web/src/modules/request-workflow/approval-repository.ts",
      "apps/web/src/modules/request-workflow/approval/ecuador-calendar.ts",
      "apps/web/src/modules/request-workflow/approval/repository.ts",
      "apps/web/src/modules/request-workflow/lifecycle-notifications.ts",
      "apps/web/src/modules/request-workflow/member-sync-checklist-observation.ts",
      "apps/web/src/modules/request-workflow/orchestration-contract.ts",
      "apps/web/src/modules/request-workflow/orchestration.ts",
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
