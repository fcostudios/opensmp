import { describe, expect, test } from "vitest";
import {
  chmod,
  readFile,
  readdir,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  classifyHttpResult,
  decimalCentsToUsd,
  inspectAdminPage,
  inspectAnalyticsPage,
  inspectEndpointSchema,
  parseManifest,
} from "./schemas.ts";
import {
  createSanitizedObservation,
  stableSecretHash,
} from "./redact.ts";
import {
  buildExecutionSchedule,
  buildProbeQuery,
  checkpointPathForOrganization,
  classifyInviteCanaryOutcome,
  executeProbeCli,
  inviteCanaryAuthorization,
  probeDefinitions,
  resolveProbeSecrets,
  runInviteCanary,
  verifyProviderOrganization,
  writeSanitizedArtifact,
} from "./probe.ts";
import {
  atomicWriteSecureJson,
  createAtomicWriteSecureJson,
  type SecureWriterDependencies,
} from "./runtime.ts";

const HASH_SALT = "synthetic-test-salt-with-at-least-32-bytes";
const EXPECTED_ORG_HASH = stableSecretHash(
  "org_synthetic_trusted",
  HASH_SALT,
);
const FIXED_NOW = new Date("2026-07-26T05:03:00Z");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "request-id": "req_synthetic_contract",
    },
  });
}

function sequencedTransport(
  responses: Response[],
  calls: Array<{ url: string; method: string }>,
): typeof fetch {
  let index = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        input instanceof Request
          ? input.url
          : input.toString(),
      method: init?.method ?? "GET",
    });
    const response = responses[index];
    index += 1;
    if (!response) throw new Error("synthetic contract sequence exhausted");
    return response;
  }) as typeof fetch;
}

const ORGANIZATION = {
  ref: "central",
  adminKeyEnv: "CENTRAL_ADMIN",
  analyticsKeyEnv: "CENTRAL_ANALYTICS",
  expectedOrganizationIdHash: EXPECTED_ORG_HASH,
};

const AUTHORIZED_ENVIRONMENT = {
  CENTRAL_ADMIN: "admin-secret",
  CENTRAL_ANALYTICS: "analytics-secret",
  PROBE_HASH_SALT: HASH_SALT,
  PROBE_ALLOW_INVITE_MUTATION: "true",
  PROBE_CANARY_EMAIL: "canary@example.invalid",
  PROBE_CANARY_EMAIL_APPROVED: "true",
  PROBE_CONFIRMED_VENDOR_ACCOUNT_REF: "central",
  PROBE_VENDOR_ACCOUNT_CONFIRMED_AT: "2026-07-26T05:00:00Z",
};

describe("public Anthropic contract fixtures", () => {
  test("classifies Admin member pagination as ID-based without retaining IDs", () => {
    const fixture = {
      data: [
        {
          type: "user",
          id: "user_synthetic_001",
          email: "alex@example.invalid",
          name: "Synthetic User",
          role: "user",
          added_at: "2026-07-01T00:00:00Z",
        },
      ],
      has_more: true,
      first_id: "user_synthetic_001",
      last_id: "user_synthetic_001",
    };

    expect(inspectAdminPage(fixture)).toEqual({
      valid: true,
      pagination: "id_cursor",
      itemCount: 1,
      hasMore: true,
      hasNextCursor: true,
      fieldTypes: expect.arrayContaining([
        "data[].email:string",
        "data[].id:string",
        "first_id:string",
        "has_more:boolean",
      ]),
    });
    expect(JSON.stringify(inspectAdminPage(fixture))).not.toContain(
      "user_synthetic_001",
    );
  });

  test("classifies Analytics pagination as an opaque page token", () => {
    const fixture = {
      data: [
        {
          user: {
            id: "user_synthetic_002",
            email_address: "sam@example.invalid",
          },
          date: "2026-07-01",
          chat_metrics: { conversation_count: 2 },
        },
      ],
      next_page: "page_synthetic_opaque",
    };

    expect(inspectAnalyticsPage(fixture)).toMatchObject({
      valid: true,
      pagination: "opaque_page",
      itemCount: 1,
      hasMore: true,
      hasNextCursor: true,
    });
  });

  test("keeps fractional cents exact without binary floating point", () => {
    expect(decimalCentsToUsd("41280.000000")).toBe("412.80000000");
    expect(decimalCentsToUsd("0.100000")).toBe("0.00100000");
    expect(() => decimalCentsToUsd("1e3")).toThrow(
      "decimal cents must use plain decimal notation",
    );
  });

  test("rejects a cost fixture whose amount is not a plain decimal string", () => {
    const validFixture = {
      data: [
        {
          starting_at: "2026-07-01T00:00:00Z",
          ending_at: "2026-07-02T00:00:00Z",
          results: [
            {
              amount: "41280.000000",
              list_amount: "50000.000000",
              currency: "USD",
            },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };
    expect(
      inspectEndpointSchema("cost_report", validFixture).valid,
    ).toBe(true);
    expect(
      inspectEndpointSchema("cost_report", {
        ...validFixture,
        data: [
          {
            ...validFixture.data[0],
            results: [{ amount: 41280, currency: "USD" }],
          },
        ],
      }).valid,
    ).toBe(false);
  });
});

describe("probe safety boundary", () => {
  test("rejects a manifest that reuses one environment variable for both key families", () => {
    expect(() =>
      parseManifest({
        organizations: [
          {
            ref: "synthetic",
            adminKeyEnv: "ANTHROPIC_SHARED_KEY",
            analyticsKeyEnv: "ANTHROPIC_SHARED_KEY",
            expectedOrganizationIdHash: EXPECTED_ORG_HASH,
          },
        ],
      }),
    ).toThrow("Admin and Analytics key environment variables must differ");
  });

  test("binds every endpoint to the documented key family and sends no beta header", () => {
    expect(
      probeDefinitions.map(({ name, keyKind, path, betaHeader }) => ({
        name,
        keyKind,
        path,
        betaHeader,
      })),
    ).toEqual([
      {
        name: "organization",
        keyKind: "admin",
        path: "/v1/organizations/me",
        betaHeader: null,
      },
      {
        name: "members",
        keyKind: "admin",
        path: "/v1/organizations/users",
        betaHeader: null,
      },
      {
        name: "invites",
        keyKind: "admin",
        path: "/v1/organizations/invites",
        betaHeader: null,
      },
      {
        name: "activity_users",
        keyKind: "analytics",
        path: "/v1/organizations/analytics/users",
        betaHeader: null,
      },
      {
        name: "activity_summaries",
        keyKind: "analytics",
        path: "/v1/organizations/analytics/summaries",
        betaHeader: null,
      },
      {
        name: "usage_report",
        keyKind: "analytics",
        path: "/v1/organizations/analytics/usage_report",
        betaHeader: null,
      },
      {
        name: "cost_report",
        keyKind: "analytics",
        path: "/v1/organizations/analytics/cost_report",
        betaHeader: null,
      },
    ]);
  });

  test("schedules every organization's read probes before any invite canary", () => {
    const organizations = [
      {
        ref: "central",
        adminKeyEnv: "CENTRAL_ADMIN",
        analyticsKeyEnv: "CENTRAL_ANALYTICS",
        expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      },
      {
        ref: "carveout",
        adminKeyEnv: "CARVEOUT_ADMIN",
        analyticsKeyEnv: "CARVEOUT_ANALYTICS",
        expectedOrganizationIdHash: EXPECTED_ORG_HASH,
      },
    ];
    const schedule = buildExecutionSchedule(organizations);
    const firstMutation = schedule.findIndex(
      ({ phase }) => phase === "invite_canary",
    );

    expect(firstMutation).toBe(probeDefinitions.length * organizations.length);
    expect(
      schedule.slice(0, firstMutation).every(({ phase }) => phase === "read"),
    ).toBe(true);
    expect(
      schedule.slice(firstMutation).map(({ organization }) => organization.ref),
    ).toEqual(["central", "carveout"]);
  });

  test("uses a single daily bucket for usage and cost evidence", () => {
    for (const name of ["usage_report", "cost_report"]) {
      const definition = probeDefinitions.find(
        (candidate) => candidate.name === name,
      );
      expect(definition).toBeDefined();
      expect(
        Object.fromEntries(
          buildProbeQuery(definition!, "2026-07-24").entries(),
        ),
      ).toEqual({
        starting_at: "2026-07-24T00:00:00Z",
        ending_at: "2026-07-25T00:00:00Z",
        bucket_width: "1d",
        limit: "1",
      });
    }
  });

  test("rejects equal resolved Admin and Analytics secrets during preflight", () => {
    const manifest = parseManifest({
      organizations: [
        {
          ref: "central",
          adminKeyEnv: "CENTRAL_ADMIN",
          analyticsKeyEnv: "CENTRAL_ANALYTICS",
          expectedOrganizationIdHash: EXPECTED_ORG_HASH,
        },
      ],
    });
    expect(() =>
      resolveProbeSecrets(manifest, {
        CENTRAL_ADMIN: "same-secret",
        CENTRAL_ANALYTICS: "same-secret",
      }),
    ).toThrow("resolved Admin and Analytics secrets must differ");
  });

  test("marks every successful-create cleanup uncertainty for manual review", () => {
    expect(
      classifyInviteCanaryOutcome({
        createStatus: 201,
        hasInviteId: false,
        cleanupStatus: null,
        createTransportFailure: false,
        cleanupTransportFailure: false,
      }),
    ).toBe("indeterminate_manual_review_required");
    expect(
      classifyInviteCanaryOutcome({
        createStatus: 201,
        hasInviteId: true,
        cleanupStatus: null,
        createTransportFailure: false,
        cleanupTransportFailure: false,
      }),
    ).toBe("indeterminate_manual_review_required");
    const nonSuccessStatuses = Array.from(
      { length: 500 },
      (_, index) => index + 100,
    ).filter((status) => status < 200 || status >= 300);
    for (const cleanupStatus of nonSuccessStatuses) {
      expect(
        classifyInviteCanaryOutcome({
          createStatus: 201,
          hasInviteId: true,
          cleanupStatus,
          createTransportFailure: false,
          cleanupTransportFailure: false,
        }),
      ).toBe("indeterminate_manual_review_required");
    }
    expect(
      classifyInviteCanaryOutcome({
        createStatus: 201,
        hasInviteId: true,
        cleanupStatus: 200,
        createTransportFailure: false,
        cleanupTransportFailure: false,
      }),
    ).toBe("executed_and_cleaned_up");
  });

  test("forces an overwritten artifact back to owner-only permissions", async () => {
    const directory = await mkdtemp(
      join(process.cwd(), ".smp-probe-test-"),
    );
    const artifactPath = join(directory, "artifact.json");
    try {
      await writeFile(artifactPath, JSON.stringify({ old: true }));
      await chmod(artifactPath, 0o644);

      await writeSanitizedArtifact(artifactPath, {
        artifact_version: 1,
        raw_bodies_persisted: false,
      });

      expect((await stat(artifactPath)).mode & 0o777).toBe(0o600);
      expect(await readFile(artifactPath, "utf8")).toBe(
        `${JSON.stringify(
          {
            artifact_version: 1,
            raw_bodies_persisted: false,
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects a symbolic-link artifact target", async () => {
    const directory = await mkdtemp(
      join(process.cwd(), ".smp-probe-link-test-"),
    );
    const realPath = join(directory, "real.json");
    const linkedPath = join(directory, "linked.json");
    try {
      await writeFile(realPath, JSON.stringify({ untouched: true }));
      await symlink(realPath, linkedPath);
      await expect(
        atomicWriteSecureJson(linkedPath, { artifact_version: 1 }),
      ).rejects.toThrow("must not contain a symbolic link");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects a symbolic-link parent directory", async () => {
    const directory = await mkdtemp(
      join(process.cwd(), ".smp-probe-parent-link-test-"),
    );
    const realDirectory = join(directory, "real");
    const linkedDirectory = join(directory, "linked");
    try {
      await mkdir(realDirectory);
      await symlink(realDirectory, linkedDirectory);
      await expect(
        atomicWriteSecureJson(join(linkedDirectory, "artifact.json"), {
          artifact_version: 1,
        }),
      ).rejects.toThrow("must not contain a symbolic link");
      expect(await readdir(realDirectory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("removes its exclusive temporary file after a real rename failure", async () => {
    const directory = await mkdtemp(
      join(process.cwd(), ".smp-probe-cleanup-test-"),
    );
    const directoryTarget = join(directory, "artifact.json");
    try {
      await mkdir(directoryTarget);
      await expect(
        atomicWriteSecureJson(directoryTarget, { artifact_version: 1 }),
      ).rejects.toThrow();
      expect(await readdir(directory)).toEqual(["artifact.json"]);
      expect(await readdir(directoryTarget)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("flushes and closes both file and directory around the atomic rename", async () => {
    const events: string[] = [];
    const outputPath = join(process.cwd(), "synthetic-artifact.json");
    const temporaryPath = join(
      process.cwd(),
      ".synthetic-artifact.json.4242.synthetic-id.tmp",
    );
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const fileHandle = {
      writeFile: async (value: string, encoding: string) => {
        events.push(`write:${encoding}:${value}`);
      },
      sync: async () => {
        events.push("file:sync");
      },
      close: async () => {
        events.push("file:close");
      },
    };
    const directoryHandle = {
      sync: async () => {
        events.push("directory:sync");
      },
      close: async () => {
        events.push("directory:close");
      },
    };
    const dependencies = {
      lstat: async (path: string) => {
        if (path === outputPath) throw missing;
        return { isSymbolicLink: () => false };
      },
      open: async (
        path: string,
        flags: "r" | "wx",
        mode?: number,
      ) => {
        events.push(`open:${path}:${flags}:${mode ?? ""}`);
        return (flags === "wx" ? fileHandle : directoryHandle) as never;
      },
      chmod: async (path: string, mode: number) => {
        events.push(`chmod:${path}:${mode.toString(8)}`);
      },
      rename: async (from: string, to: string) => {
        events.push(`rename:${from}:${to}`);
      },
      unlink: async (path: string) => {
        events.push(`unlink:${path}`);
      },
      randomId: () => "synthetic-id",
      processId: 4242,
    } satisfies SecureWriterDependencies;

    await createAtomicWriteSecureJson(dependencies)(outputPath, {
      artifact_version: 1,
    });

    expect(events).toEqual([
      `open:${temporaryPath}:wx:384`,
      `write:utf8:${JSON.stringify({ artifact_version: 1 }, null, 2)}\n`,
      "file:sync",
      "file:close",
      `chmod:${temporaryPath}:600`,
      `rename:${temporaryPath}:${outputPath}`,
      `chmod:${outputPath}:600`,
      `open:${process.cwd()}:r:`,
      "directory:sync",
      "directory:close",
    ]);
  });

  test("closes and unlinks an injected temporary file after write failure", async () => {
    const events: string[] = [];
    const outputPath = join(process.cwd(), "synthetic-failure.json");
    const temporaryPath = join(
      process.cwd(),
      ".synthetic-failure.json.4242.synthetic-id.tmp",
    );
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const dependencies = {
      lstat: async (path: string) => {
        if (path === outputPath) throw missing;
        return { isSymbolicLink: () => false };
      },
      open: async () =>
        ({
          writeFile: async () => {
            events.push("write:failed");
            throw new Error("synthetic write failure");
          },
          sync: async () => undefined,
          close: async () => {
            events.push("file:close");
          },
        }) as never,
      chmod: async () => undefined,
      rename: async () => undefined,
      unlink: async (path: string) => {
        events.push(`unlink:${path}`);
      },
      randomId: () => "synthetic-id",
      processId: 4242,
    } satisfies SecureWriterDependencies;

    await expect(
      createAtomicWriteSecureJson(dependencies)(outputPath, {
        artifact_version: 1,
      }),
    ).rejects.toThrow("synthetic write failure");
    expect(events).toEqual([
      "write:failed",
      "file:close",
      `unlink:${temporaryPath}`,
    ]);
  });

  test("derives isolated checkpoint filenames from safe organization hashes", () => {
    const first = stableSecretHash("central", HASH_SALT);
    const second = stableSecretHash("carveout", HASH_SALT);
    const firstPath = checkpointPathForOrganization(
      "docs/spikes/probe.checkpoint.json",
      first,
    );
    const secondPath = checkpointPathForOrganization(
      "docs/spikes/probe.checkpoint.json",
      second,
    );

    expect(firstPath).not.toBe(secondPath);
    expect(firstPath).toMatch(
      /^docs\/spikes\/probe\.checkpoint\.[a-f0-9]{64}\.json$/,
    );
    expect(firstPath).not.toContain("central");
    expect(() =>
      checkpointPathForOrganization(
        "docs/spikes/probe.checkpoint.json",
        "../unsafe",
      ),
    ).toThrow("organization reference hash is not a safe HMAC");
  });

  test("requires every invite mutation authorization signal for the same org", () => {
    const base = {
      allowMutation: "true",
      canaryEmail: "canary@example.invalid",
      canaryEmailApproved: "true",
      confirmedVendorAccountRef: "central",
      confirmedAt: "2026-07-26T05:00:00Z",
      organizationRef: "central",
      now: new Date("2026-07-26T05:03:00Z"),
    };

    expect(inviteCanaryAuthorization(base)).toEqual({
      authorized: true,
      reason: "all_operator_gates_confirmed",
    });
    expect(
      inviteCanaryAuthorization({ ...base, allowMutation: "false" }),
    ).toMatchObject({ authorized: false, reason: "mutation_not_enabled" });
    expect(
      inviteCanaryAuthorization({ ...base, canaryEmailApproved: "false" }),
    ).toMatchObject({ authorized: false, reason: "email_not_approved" });
    expect(
      inviteCanaryAuthorization({
        ...base,
        confirmedVendorAccountRef: "another-org",
      }),
    ).toMatchObject({
      authorized: false,
      reason: "vendor_account_not_confirmed",
    });
    expect(
      inviteCanaryAuthorization({
        ...base,
        now: new Date("2026-07-26T05:06:00Z"),
      }),
    ).toMatchObject({
      authorized: false,
      reason: "vendor_account_confirmation_stale",
    });
  });

  test("binds the Admin response to the operator-supplied organization hash", () => {
    const trusted = {
      id: "org_synthetic_trusted",
      name: "Synthetic Trusted Organization",
      type: "organization",
    };
    expect(
      verifyProviderOrganization(200, trusted, EXPECTED_ORG_HASH, HASH_SALT),
    ).toBe(true);
    expect(
      verifyProviderOrganization(
        200,
        { ...trusted, id: "org_synthetic_wrong" },
        EXPECTED_ORG_HASH,
        HASH_SALT,
      ),
    ).toBe(false);
    expect(JSON.stringify(EXPECTED_ORG_HASH)).not.toContain(
      "org_synthetic_trusted",
    );
    expect(
      verifyProviderOrganization(199, trusted, EXPECTED_ORG_HASH, HASH_SALT),
    ).toBe(false);
    expect(
      verifyProviderOrganization(300, trusted, EXPECTED_ORG_HASH, HASH_SALT),
    ).toBe(false);
    expect(
      verifyProviderOrganization(
        200,
        { name: "Missing ID", type: "organization" },
        EXPECTED_ORG_HASH,
        HASH_SALT,
      ),
    ).toBe(false);
  });

  test("does not mutate or checkpoint before provider target verification", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: false,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport([], calls),
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(result).toEqual({
      status: "not_executed",
      reason: "provider_target_not_verified",
      checkpoint_file: "synthetic-checkpoint.json",
    });
    expect(calls).toEqual([]);
    expect(checkpoints).toEqual([]);
  });

  test("does not mutate or checkpoint without complete operator authorization", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: {
        ...AUTHORIZED_ENVIRONMENT,
        PROBE_CANARY_EMAIL_APPROVED: "false",
      },
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport([], calls),
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(result).toEqual({
      status: "not_executed",
      reason: "email_not_approved",
      checkpoint_file: "synthetic-checkpoint.json",
    });
    expect(calls).toEqual([]);
    expect(checkpoints).toEqual([]);
  });

  test("checkpoints authorization before create and confirms cleanup", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [
          jsonResponse(201, {
            type: "invite",
            id: "invite_synthetic_canary",
            email: "canary@example.invalid",
            status: "pending",
            role: "user",
          }),
          jsonResponse(200, {
            type: "invite_deleted",
            id: "invite_synthetic_canary",
          }),
        ],
        calls,
      ),
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(calls.map(({ method }) => method)).toEqual(["POST", "DELETE"]);
    expect(checkpoints.map(({ state }) => state)).toEqual([
      "authorized_canary_pending",
      "invite_create_confirmed",
      "invite_cleanup_confirmed",
    ]);
    expect(
      checkpoints.slice(0, 2).map(
        ({ manual_review_required }) => manual_review_required,
      ),
    ).toEqual([true, true]);
    expect(checkpoints.at(-1)?.manual_review_required).toBe(false);
    expect(result.status).toBe("executed_and_cleaned_up");
    expect(JSON.stringify(checkpoints)).not.toContain(
      "invite_synthetic_canary",
    );
  });

  test("never deletes an ID returned by a non-success create response", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [
          jsonResponse(400, {
            type: "invite",
            id: "invite_must_not_delete",
            email: "canary@example.invalid",
            status: "pending",
          }),
        ],
        calls,
      ),
      writeCheckpoint: async () => undefined,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(result.status).toBe("attempted_not_created");
  });

  test("marks a 2xx create without a contract-valid ID as indeterminate", async () => {
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [jsonResponse(201, { type: "invite", status: "pending" })],
        [],
      ),
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(result.status).toBe("indeterminate_manual_review_required");
    expect(checkpoints.at(-1)).toMatchObject({
      state: "invite_create_indeterminate",
      manual_review_required: true,
    });
  });

  test("persists indeterminate evidence for create transport failure", async () => {
    const checkpoints: Record<string, unknown>[] = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: (async () => {
        throw new Error("synthetic create transport failure");
      }) as typeof fetch,
      writeCheckpoint: async (_path, checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(checkpoints.map(({ state }) => state)).toEqual([
      "authorized_canary_pending",
      "invite_create_indeterminate",
    ]);
    expect(checkpoints.at(-1)?.manual_review_required).toBe(true);
    expect(result).toEqual({
      status: "indeterminate_manual_review_required",
      checkpoint_file: "synthetic-checkpoint.json",
      checkpoint: { classification: "persisted" },
      create: { classification: "network_or_transport_failure" },
      cleanup: { status: "not_confirmed" },
    });
  });

  test("does not POST when the pre-mutation checkpoint cannot be persisted", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport([], calls),
      writeCheckpoint: async () => {
        throw new Error("synthetic checkpoint persistence failure");
      },
    });

    expect(calls).toEqual([]);
    expect(result).toEqual({
      status: "indeterminate_manual_review_required",
      checkpoint_file: "synthetic-checkpoint.json",
      checkpoint: { classification: "checkpoint_persistence_failure" },
      create: { status: "not_attempted" },
      cleanup: null,
    });
  });

  test("separates create checkpoint failure from transport and still cleans up", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const persisted: Record<string, unknown>[] = [];
    let writeNumber = 0;
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [
          jsonResponse(201, {
            type: "invite",
            id: "invite_synthetic_canary",
            email: "canary@example.invalid",
            status: "pending",
            role: "user",
          }),
          jsonResponse(200, {
            type: "invite_deleted",
            id: "invite_synthetic_canary",
          }),
        ],
        calls,
      ),
      writeCheckpoint: async (_path, checkpoint) => {
        writeNumber += 1;
        if (writeNumber === 2) {
          throw new Error("synthetic create-checkpoint failure");
        }
        persisted.push(checkpoint);
      },
    });

    expect(calls.map(({ method }) => method)).toEqual(["POST", "DELETE"]);
    expect(persisted.map(({ state }) => state)).toEqual([
      "authorized_canary_pending",
      "invite_cleanup_confirmed",
    ]);
    expect(persisted[0]?.manual_review_required).toBe(true);
    expect(persisted[1]?.manual_review_required).toBe(false);
    expect(result).toMatchObject({
      status: "indeterminate_manual_review_required",
      checkpoint: { classification: "checkpoint_persistence_failure" },
    });
    expect(result.create).not.toEqual({
      classification: "network_or_transport_failure",
    });
  });

  test("preserves create-confirmed manual-review evidence when cleanup checkpoint fails", async () => {
    const persisted: Record<string, unknown>[] = [];
    let writeNumber = 0;
    const result = await runInviteCanary({
      organization: ORGANIZATION,
      adminKey: "admin-secret",
      hashSalt: HASH_SALT,
      organizationRefHash: stableSecretHash("central", HASH_SALT),
      providerTargetVerified: true,
      checkpointPath: "synthetic-checkpoint.json",
      environment: AUTHORIZED_ENVIRONMENT,
      now: () => FIXED_NOW,
      fetchImpl: sequencedTransport(
        [
          jsonResponse(201, {
            type: "invite",
            id: "invite_synthetic_canary",
            email: "canary@example.invalid",
            status: "pending",
            role: "user",
          }),
          jsonResponse(200, {
            type: "invite_deleted",
            id: "invite_synthetic_canary",
          }),
        ],
        [],
      ),
      writeCheckpoint: async (_path, checkpoint) => {
        writeNumber += 1;
        if (writeNumber === 3) {
          throw new Error("synthetic cleanup-checkpoint failure");
        }
        persisted.push(checkpoint);
      },
    });

    expect(persisted.map(({ state }) => state)).toEqual([
      "authorized_canary_pending",
      "invite_create_confirmed",
    ]);
    expect(
      persisted.every(
        ({ manual_review_required }) => manual_review_required === true,
      ),
    ).toBe(true);
    expect(result).toMatchObject({
      status: "indeterminate_manual_review_required",
      checkpoint: { classification: "checkpoint_persistence_failure" },
    });
  });

  test("persists indeterminate evidence for cleanup rejection and transport failure", async () => {
    for (const cleanupResponse of [
      jsonResponse(500, { type: "error" }),
      new Error("synthetic cleanup transport failure"),
    ]) {
      const checkpoints: Record<string, unknown>[] = [];
      let requestNumber = 0;
      const result = await runInviteCanary({
        organization: ORGANIZATION,
        adminKey: "admin-secret",
        hashSalt: HASH_SALT,
        organizationRefHash: stableSecretHash("central", HASH_SALT),
        providerTargetVerified: true,
        checkpointPath: "synthetic-checkpoint.json",
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        fetchImpl: (async () => {
          requestNumber += 1;
          if (requestNumber === 1) {
            return jsonResponse(201, {
              type: "invite",
              id: "invite_synthetic_canary",
              email: "canary@example.invalid",
              status: "pending",
              role: "user",
            });
          }
          if (cleanupResponse instanceof Error) throw cleanupResponse;
          return cleanupResponse;
        }) as typeof fetch,
        writeCheckpoint: async (_path, checkpoint) => {
          checkpoints.push(checkpoint);
        },
      });

      expect(result.status).toBe("indeterminate_manual_review_required");
      expect(checkpoints.at(-1)).toMatchObject({
        state: "invite_cleanup_indeterminate",
        manual_review_required: true,
      });
      if (cleanupResponse instanceof Error) {
        expect(result.cleanup).toEqual({
          status: "indeterminate_manual_review_required",
          classification: "network_or_transport_failure",
        });
      }
    }
  });

  test("classifies create and cleanup status boundaries exactly", () => {
    const classify = (
      createStatus: number | null,
      hasInviteId: boolean,
      cleanupStatus: number | null,
      createTransportFailure = false,
      cleanupTransportFailure = false,
    ) =>
      classifyInviteCanaryOutcome({
        createStatus,
        hasInviteId,
        cleanupStatus,
        createTransportFailure,
        cleanupTransportFailure,
      });

    expect(classify(null, false, null, true)).toBe(
      "indeterminate_manual_review_required",
    );
    expect(classify(null, false, null)).toBe("attempted_not_created");
    expect(classify(199, false, null)).toBe("attempted_not_created");
    expect(classify(200, false, null)).toBe(
      "indeterminate_manual_review_required",
    );
    expect(classify(299, true, 200)).toBe("executed_and_cleaned_up");
    expect(classify(300, true, 200)).toBe("attempted_not_created");
    expect(classify(201, true, 200, false, true)).toBe(
      "indeterminate_manual_review_required",
    );
    expect(classify(201, true, 199)).toBe(
      "indeterminate_manual_review_required",
    );
    expect(classify(201, true, 299)).toBe("executed_and_cleaned_up");
    expect(classify(201, true, 300)).toBe(
      "indeterminate_manual_review_required",
    );
  });

  test("returns non-zero CLI status for an indeterminate create", async () => {
    const writes: Array<{
      path: string;
      value: Record<string, unknown>;
    }> = [];
    const stderr: string[] = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--checkpoint",
        "synthetic-checkpoint.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        readText: async () =>
          JSON.stringify({ organizations: [ORGANIZATION] }),
        fetchImpl: sequencedTransport(
          [
            jsonResponse(200, {
              id: "org_synthetic_trusted",
              name: "Synthetic Trusted Organization",
              type: "organization",
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, { data: [], next_page: null }),
            jsonResponse(200, { summaries: [] }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(201, { type: "invite", status: "pending" }),
          ],
          [],
        ),
        writeSecureJson: async (path, value) => {
          writes.push({ path, value });
        },
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(2);
    expect(stderr).toEqual([
      `${JSON.stringify({
        status: "canary_manual_review_required",
      })}\n`,
    ]);
    expect(
      writes.some(
        ({ path, value }) =>
          path.startsWith("synthetic-checkpoint.") &&
          path.endsWith(".json") &&
          value.state === "authorized_canary_pending",
      ),
    ).toBe(true);
    expect(
      writes.some(({ path }) => path === "synthetic-artifact.json"),
    ).toBe(true);
  });

  test("returns explicit manual-review CLI status for checkpoint persistence failure", async () => {
    const stderr: string[] = [];
    const writes: string[] = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--checkpoint",
        "synthetic-checkpoint.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        readText: async () =>
          JSON.stringify({ organizations: [ORGANIZATION] }),
        fetchImpl: sequencedTransport(
          [
            jsonResponse(200, {
              id: "org_synthetic_trusted",
              name: "Synthetic Trusted Organization",
              type: "organization",
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, { data: [], next_page: null }),
            jsonResponse(200, { summaries: [] }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
          ],
          [],
        ),
        writeSecureJson: async (path) => {
          if (path.startsWith("synthetic-checkpoint.")) {
            throw new Error("synthetic checkpoint persistence failure");
          }
          writes.push(path);
        },
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(2);
    expect(stderr).toEqual([
      `${JSON.stringify({
        status: "canary_manual_review_required",
      })}\n`,
    ]);
    expect(writes).toEqual(["synthetic-artifact.json"]);
  });

  test("keeps cleanup checkpoint evidence when artifact writing fails", async () => {
    const checkpoints: Record<string, unknown>[] = [];
    const stderr: string[] = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--checkpoint",
        "synthetic-checkpoint.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        readText: async () =>
          JSON.stringify({ organizations: [ORGANIZATION] }),
        fetchImpl: sequencedTransport(
          [
            jsonResponse(200, {
              id: "org_synthetic_trusted",
              name: "Synthetic Trusted Organization",
              type: "organization",
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, { data: [], next_page: null }),
            jsonResponse(200, { summaries: [] }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(201, {
              type: "invite",
              id: "invite_synthetic_canary",
              email: "canary@example.invalid",
              status: "pending",
            }),
            jsonResponse(200, {
              type: "invite_deleted",
              id: "invite_synthetic_canary",
            }),
          ],
          [],
        ),
        writeSecureJson: async (path, value) => {
          if (path === "synthetic-artifact.json") {
            throw new Error("synthetic artifact boundary failure");
          }
          checkpoints.push(value);
        },
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${JSON.stringify({ status: "probe_failed" })}\n`,
    ]);
    expect(checkpoints.at(-1)).toMatchObject({
      state: "invite_cleanup_confirmed",
      manual_review_required: false,
    });
  });

  test("returns zero and a sanitized summary when mutation is not authorized", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writes: Array<{ path: string; value: Record<string, unknown> }> = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--checkpoint",
        "synthetic-checkpoint.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: {
          ...AUTHORIZED_ENVIRONMENT,
          PROBE_ALLOW_INVITE_MUTATION: "false",
        },
        now: () => FIXED_NOW,
        readText: async () =>
          JSON.stringify({ organizations: [ORGANIZATION] }),
        fetchImpl: sequencedTransport(
          [
            jsonResponse(200, {
              id: "org_synthetic_trusted",
              name: "Synthetic Trusted Organization",
              type: "organization",
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              first_id: null,
              last_id: null,
            }),
            jsonResponse(200, { data: [], next_page: null }),
            jsonResponse(200, { summaries: [] }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
            jsonResponse(200, {
              data: [],
              has_more: false,
              next_page: null,
            }),
          ],
          [],
        ),
        writeSecureJson: async (path, value) => {
          writes.push({ path, value });
        },
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(writes.map(({ path }) => path)).toEqual([
      "synthetic-artifact.json",
    ]);
    expect(stdout).toEqual([
      `${JSON.stringify({
        status: "sanitized_artifact_written",
        output: "synthetic-artifact.json",
        organizations: 1,
      })}\n`,
    ]);
  });

  test("maps invalid manifest JSON to a generic non-zero CLI result", async () => {
    const stderr: string[] = [];
    const exitCode = await executeProbeCli({
      argv: [
        "--manifest",
        "synthetic-manifest.json",
        "--output",
        "synthetic-artifact.json",
        "--date",
        "2026-07-24",
      ],
      runtime: {
        environment: AUTHORIZED_ENVIRONMENT,
        now: () => FIXED_NOW,
        readText: async () => "{invalid-json",
        fetchImpl: sequencedTransport([], []),
        writeSecureJson: async () => undefined,
      },
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${JSON.stringify({ status: "invalid_manifest_json" })}\n`,
    ]);
  });

  test("emits only allowlisted metadata and salted hashes", () => {
    const body = {
      data: [
        {
          id: "user_private_123",
          email: "private@example.com",
          name: "Private Person",
          role: "user",
        },
      ],
      has_more: false,
      first_id: "user_private_123",
      last_id: "user_private_123",
      unrecognized_secret: "must-not-survive",
    };
    const observation = createSanitizedObservation({
      endpoint: "members",
      keyKind: "admin",
      status: 200,
      headers: {
        "request-id": "req_private_123",
        "retry-after": "2",
        "anthropic-ratelimit-requests-remaining": "58",
        authorization: "Bearer should-never-survive",
        "x-api-key": "sk-ant-private",
        "set-cookie": "private-cookie",
      },
      body,
      hashSalt: HASH_SALT,
      sentBetaHeader: null,
    });
    const serialized = JSON.stringify(observation);

    expect(observation).toMatchObject({
      endpoint: "members",
      key_kind: "admin",
      status: 200,
      classification: "success",
      response_headers: {
        retry_after: "2",
        rate_limit: {
          "anthropic-ratelimit-requests-remaining": "58",
        },
        request_id_hash: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/),
      },
      schema: {
        valid: true,
        pagination: "id_cursor",
        itemCount: 1,
      },
    });
    // Repeated cursor IDs collapse to the same stable hash.
    expect(observation.sensitive_value_hashes).toHaveLength(3);
    for (const forbidden of [
      "user_private_123",
      "private@example.com",
      "Private Person",
      "must-not-survive",
      "Bearer",
      "sk-ant",
      "private-cookie",
      "req_private_123",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("uses deterministic HMAC hashes scoped by the supplied salt", () => {
    const first = stableSecretHash("same-private-id", HASH_SALT);
    expect(stableSecretHash("same-private-id", HASH_SALT)).toBe(first);
    expect(
      stableSecretHash(
        "same-private-id",
        "different-synthetic-salt-with-32-bytes",
      ),
    ).not.toBe(first);
    expect(first).not.toContain("same-private-id");
  });

  test("classifies key-family and rate-limit failures without retaining a body", () => {
    expect(classifyHttpResult(403)).toBe(
      "authorization_or_key_type_mismatch",
    );
    expect(classifyHttpResult(429)).toBe("rate_limited");
    expect(classifyHttpResult(404)).toBe(
      "route_or_header_behavior_not_available",
    );
  });
});
