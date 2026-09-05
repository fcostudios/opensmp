**Work item:** US-059
**Readiness assessment:** docs/readiness/US-059.json
**Approved estimate:** 75 minutes

# Anthropic Transport Credential Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A request to the vendor API carries the correct header policy for its endpoint, and a credential routed to the wrong capability is rejected **before any network call is issued**.

**Architecture:** Three small modules under `packages/connectors/src/providers/anthropic/` — an endpoint table, a credential resolver that fails closed, and a request builder. `fetch` is injected so every test can assert on whether a call was attempted at all, which is the only way to prove "fails closed *before* the request".

**Tech Stack:** TypeScript, Vitest, `fetch` via injection. **No runtime dependencies** — `packages/connectors/package.json` declares `dependencies: {}` and that is deliberate for a vendor-neutral package.

**Spec:** `docs/stories/sprint-3/r1_misc_us_018.md` (AC1) and `docs/readiness/US-059.json`

## Global Constraints

- **This is half of AC1.** US-060 carries rate limiting and bounded retry. **AC1 closes only when US-059 and US-060 have both landed.** Do not report AC1 as met when this story closes.
- **Provider code lives only in `packages/connectors/src/providers/anthropic/`.** That path and `scripts/probes/**` are the only two exempt from the provider-boundary lint (`packages/config/eslint-preset.mjs:5-6`, `source-boundary.ts:226`). A vendor token anywhere else fails `pnpm lint:provider-boundary`.
- **Port, do not import.** `scripts/probes/anthropic/**` is exempt for the probe's own benefit. Importing it from the connector would drag an exempt path into shipped code. Re-implement against the connector's own contracts.
- **No new dependencies.** Hand-roll everything.
- **No live credentials exist.** Every test uses an injected `fetch` double. There is no network call in this story.
- **Commit messages reference `US-059` and no other work ID.** Naming a `partition_required` item (US-018, US-056, US-058 all are) fails the commit with `WR_WORK_NOT_READY`.

## Source facts, verified — do not re-derive these

Read from source rather than assumed. If any of these is wrong, stop and report rather than adapting.

| Fact | Value | Source |
|---|---|---|
| API origin | `https://api.anthropic.com` | `probe.ts:28` |
| API version header | `2023-06-01` | `probe.ts:29` |
| Header block | `x-api-key`, `anthropic-version`, `accept: application/json`, `user-agent` | `probe.ts:318-322` |
| Timeout | `AbortSignal.timeout(30_000)` | `probe.ts:325` |
| Key kinds | `"admin" | "analytics"` | `schemas.ts:1` |
| **Beta headers** | **`null` on all seven endpoints** | `probe.ts` `probeDefinitions` |
| Admin ≠ Analytics enforced | `if (admin === analytics) throw` | `probe.ts:229+` `resolveProbeSecrets` |

**The beta-header finding matters for scope.** AC1 says "endpoint-specific header policy", but every endpoint currently carries `betaHeader: null`. So the policy is **per-capability** (which credential) plus a **per-endpoint override slot that is currently unused everywhere**. Build the slot, do not invent a per-endpoint header matrix that has no source.

The seven endpoints and their required capability:

| endpoint | key kind | path |
|---|---|---|
| `organization` | admin | `/v1/organizations/me` |
| `members` | admin | `/v1/organizations/users` |
| `invites` | admin | `/v1/organizations/invites` |
| `activity_users` | analytics | `/v1/organizations/analytics/users` |
| `activity_summaries` | analytics | `/v1/organizations/analytics/summaries` |
| `usage_report` | analytics | `/v1/organizations/analytics/usage_report` |
| `cost_report` | analytics | `/v1/organizations/analytics/cost_report` |

## A note on test design for this story

Every negative test here must prove the failure happened **before** the network call, not merely that a call failed. A test asserting only "it throws" passes whether the implementation rejects up front or calls `fetch` and throws on the response — so it does not discriminate, and it is worthless as a security assertion.

**Every fail-closed test must assert `fetchCalls.length === 0`.** That is the discriminating assertion. If you write a negative test without it, you have not tested the requirement.

---

### Task 1: Endpoint table

**Files:**
- Create: `packages/connectors/src/providers/anthropic/endpoints.ts`
- Test: `packages/connectors/src/providers/anthropic/endpoints.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```typescript
  export type AnthropicKeyKind = "admin" | "analytics";
  export interface AnthropicEndpoint {
    readonly name: string;
    readonly keyKind: AnthropicKeyKind;
    readonly path: string;
    readonly betaHeader: string | null;
  }
  export const ANTHROPIC_ENDPOINTS: Readonly<Record<string, AnthropicEndpoint>>;
  export function anthropicEndpoint(name: string): AnthropicEndpoint;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// packages/connectors/src/providers/anthropic/endpoints.test.ts
import { describe, expect, it } from "vitest";

import { ANTHROPIC_ENDPOINTS, anthropicEndpoint } from "./endpoints.js";

describe("ANTHROPIC_ENDPOINTS", () => {
  it("routes each endpoint to the capability its path requires", () => {
    const byKind = Object.values(ANTHROPIC_ENDPOINTS).map(
      (endpoint) => [endpoint.name, endpoint.keyKind] as const,
    );
    expect(Object.fromEntries(byKind)).toEqual({
      organization: "admin",
      members: "admin",
      invites: "admin",
      activity_users: "analytics",
      activity_summaries: "analytics",
      usage_report: "analytics",
      cost_report: "analytics",
    });
  });

  it("carries the exact analytics paths", () => {
    expect(ANTHROPIC_ENDPOINTS.usage_report.path).toBe(
      "/v1/organizations/analytics/usage_report",
    );
    expect(ANTHROPIC_ENDPOINTS.members.path).toBe("/v1/organizations/users");
  });

  it("declares no beta header on any endpoint", () => {
    for (const endpoint of Object.values(ANTHROPIC_ENDPOINTS)) {
      expect(endpoint.betaHeader).toBeNull();
    }
  });

  it("rejects an unknown endpoint name rather than returning undefined", () => {
    expect(() => anthropicEndpoint("nope")).toThrow(/unknown Anthropic endpoint/u);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/connectors && npx vitest run src/providers/anthropic/endpoints.test.ts`
Expected: FAIL — cannot resolve `./endpoints.js`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/connectors/src/providers/anthropic/endpoints.ts
export type AnthropicKeyKind = "admin" | "analytics";

export interface AnthropicEndpoint {
  readonly name: string;
  readonly keyKind: AnthropicKeyKind;
  readonly path: string;
  /**
   * Per-endpoint override slot. Every endpoint is null today; the slot exists
   * because the provider's own probe descriptors carry one.
   */
  readonly betaHeader: string | null;
}

function endpoint(
  name: string,
  keyKind: AnthropicKeyKind,
  path: string,
): AnthropicEndpoint {
  return Object.freeze({ name, keyKind, path, betaHeader: null });
}

export const ANTHROPIC_ENDPOINTS = Object.freeze({
  organization: endpoint("organization", "admin", "/v1/organizations/me"),
  members: endpoint("members", "admin", "/v1/organizations/users"),
  invites: endpoint("invites", "admin", "/v1/organizations/invites"),
  activity_users: endpoint(
    "activity_users", "analytics", "/v1/organizations/analytics/users",
  ),
  activity_summaries: endpoint(
    "activity_summaries", "analytics", "/v1/organizations/analytics/summaries",
  ),
  usage_report: endpoint(
    "usage_report", "analytics", "/v1/organizations/analytics/usage_report",
  ),
  cost_report: endpoint(
    "cost_report", "analytics", "/v1/organizations/analytics/cost_report",
  ),
}) satisfies Readonly<Record<string, AnthropicEndpoint>>;

export function anthropicEndpoint(name: string): AnthropicEndpoint {
  const found = (ANTHROPIC_ENDPOINTS as Record<string, AnthropicEndpoint>)[name];
  if (!found) throw new Error(`unknown Anthropic endpoint: ${name}`);
  return found;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/connectors && npx vitest run src/providers/anthropic/endpoints.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/providers/anthropic/endpoints.ts packages/connectors/src/providers/anthropic/endpoints.test.ts
git commit -m "feat(US-059): add Anthropic endpoint capability table"
```

---

### Task 2: Fail-closed credential resolution

**Files:**
- Create: `packages/connectors/src/providers/anthropic/credentials.ts`
- Test: `packages/connectors/src/providers/anthropic/credentials.test.ts`

**Interfaces:**
- Consumes: `AnthropicKeyKind`, `AnthropicEndpoint` (Task 1)
- Produces:
  ```typescript
  export interface AnthropicCredentials {
    readonly admin: string;
    readonly analytics: string;
  }
  export function createAnthropicCredentials(input: {
    readonly admin: string | undefined;
    readonly analytics: string | undefined;
  }): AnthropicCredentials;
  export function credentialFor(
    credentials: AnthropicCredentials,
    endpoint: AnthropicEndpoint,
  ): string;
  ```

The `admin === analytics` rejection is carried from `resolveProbeSecrets` (`probe.ts:229+`), which already enforces "resolved Admin and Analytics secrets must differ". If the two keys are the same value, capability separation is not real and routing cannot fail closed — so it is rejected at construction rather than per call.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/connectors/src/providers/anthropic/credentials.test.ts
import { describe, expect, it } from "vitest";

import { createAnthropicCredentials, credentialFor } from "./credentials.js";
import { ANTHROPIC_ENDPOINTS } from "./endpoints.js";

const valid = { admin: "admin-key", analytics: "analytics-key" };

describe("createAnthropicCredentials", () => {
  it("accepts two distinct non-empty keys", () => {
    expect(createAnthropicCredentials(valid)).toEqual(valid);
  });

  it("rejects identical admin and analytics keys", () => {
    expect(() =>
      createAnthropicCredentials({ admin: "same", analytics: "same" }),
    ).toThrow(/must differ/u);
  });

  it("rejects a missing admin key", () => {
    expect(() =>
      createAnthropicCredentials({ admin: undefined, analytics: "analytics-key" }),
    ).toThrow(/admin/u);
  });

  it("rejects a blank analytics key rather than treating it as present", () => {
    expect(() =>
      createAnthropicCredentials({ admin: "admin-key", analytics: "   " }),
    ).toThrow(/analytics/u);
  });
});

describe("credentialFor", () => {
  it("selects the admin key for an admin endpoint", () => {
    const credentials = createAnthropicCredentials(valid);
    expect(credentialFor(credentials, ANTHROPIC_ENDPOINTS.invites)).toBe("admin-key");
  });

  it("selects the analytics key for an analytics endpoint", () => {
    const credentials = createAnthropicCredentials(valid);
    expect(credentialFor(credentials, ANTHROPIC_ENDPOINTS.cost_report)).toBe(
      "analytics-key",
    );
  });

  it("never returns the analytics key for an admin endpoint", () => {
    const credentials = createAnthropicCredentials(valid);
    for (const name of ["organization", "members", "invites"] as const) {
      expect(credentialFor(credentials, ANTHROPIC_ENDPOINTS[name])).not.toBe(
        "analytics-key",
      );
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/connectors && npx vitest run src/providers/anthropic/credentials.test.ts`
Expected: FAIL — cannot resolve `./credentials.js`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/connectors/src/providers/anthropic/credentials.ts
import type { AnthropicEndpoint } from "./endpoints.js";

export interface AnthropicCredentials {
  readonly admin: string;
  readonly analytics: string;
}

function required(value: string | undefined, kind: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Anthropic ${kind} credential is required`);
  }
  return value;
}

export function createAnthropicCredentials(input: {
  readonly admin: string | undefined;
  readonly analytics: string | undefined;
}): AnthropicCredentials {
  const admin = required(input.admin, "admin");
  const analytics = required(input.analytics, "analytics");
  // Carried from the probe's resolveProbeSecrets: if both capabilities hold the
  // same secret, separation is not real and routing cannot fail closed.
  if (admin === analytics) {
    throw new Error("Anthropic admin and analytics credentials must differ");
  }
  return Object.freeze({ admin, analytics });
}

export function credentialFor(
  credentials: AnthropicCredentials,
  endpoint: AnthropicEndpoint,
): string {
  return endpoint.keyKind === "admin" ? credentials.admin : credentials.analytics;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/connectors && npx vitest run src/providers/anthropic/credentials.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/providers/anthropic/credentials.ts packages/connectors/src/providers/anthropic/credentials.test.ts
git commit -m "feat(US-059): add fail-closed Anthropic credential resolution"
```

---

### Task 3: Request builder with fail-closed capability routing

**Files:**
- Create: `packages/connectors/src/providers/anthropic/request.ts`
- Test: `packages/connectors/src/providers/anthropic/request.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2
- Produces:
  ```typescript
  export const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
  export const ANTHROPIC_API_VERSION = "2023-06-01";
  export function anthropicRequest(dependencies: {
    readonly credentials: AnthropicCredentials;
    readonly fetchImpl: typeof fetch;
  }, input: {
    readonly endpoint: string;
    readonly keyKind: AnthropicKeyKind;
    readonly init?: RequestInit;
  }): Promise<Response>;
  ```

`keyKind` is passed by the **caller** and checked against the endpoint's declared kind. That is the whole point: a caller that believes it is making an analytics call must not be able to reach an admin endpoint. Deriving the kind from the endpoint alone would make the mismatch unrepresentable and the requirement untestable.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/connectors/src/providers/anthropic/request.test.ts
import { describe, expect, it } from "vitest";

import { createAnthropicCredentials } from "./credentials.js";
import {
  ANTHROPIC_API_ORIGIN,
  ANTHROPIC_API_VERSION,
  anthropicRequest,
} from "./request.js";

const credentials = createAnthropicCredentials({
  admin: "admin-key",
  analytics: "analytics-key",
});

function recordingFetch() {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
    });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("anthropicRequest", () => {
  it("issues an admin call with the exact header policy", async () => {
    const { calls, fetchImpl } = recordingFetch();

    await anthropicRequest(
      { credentials, fetchImpl },
      { endpoint: "invites", keyKind: "admin" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ANTHROPIC_API_ORIGIN}/v1/organizations/invites`);
    expect(calls[0].headers.get("x-api-key")).toBe("admin-key");
    expect(calls[0].headers.get("anthropic-version")).toBe(ANTHROPIC_API_VERSION);
    expect(calls[0].headers.get("accept")).toBe("application/json");
    expect(calls[0].headers.get("user-agent")).toMatch(/^Ledger-Connector\//u);
  });

  it("sends the analytics key to an analytics endpoint", async () => {
    const { calls, fetchImpl } = recordingFetch();

    await anthropicRequest(
      { credentials, fetchImpl },
      { endpoint: "cost_report", keyKind: "analytics" },
    );

    expect(calls[0].headers.get("x-api-key")).toBe("analytics-key");
  });

  it("omits the beta header entirely when the endpoint declares none", async () => {
    const { calls, fetchImpl } = recordingFetch();

    await anthropicRequest(
      { credentials, fetchImpl },
      { endpoint: "members", keyKind: "admin" },
    );

    expect(calls[0].headers.has("anthropic-beta")).toBe(false);
  });

  it("rejects an analytics caller on an admin endpoint WITHOUT issuing a request", async () => {
    const { calls, fetchImpl } = recordingFetch();

    await expect(
      anthropicRequest(
        { credentials, fetchImpl },
        { endpoint: "invites", keyKind: "analytics" },
      ),
    ).rejects.toThrow(/capability mismatch/u);

    // The discriminating assertion: a check that ran after fetch would fail here.
    expect(calls).toHaveLength(0);
  });

  it("rejects an admin caller on an analytics endpoint WITHOUT issuing a request", async () => {
    const { calls, fetchImpl } = recordingFetch();

    await expect(
      anthropicRequest(
        { credentials, fetchImpl },
        { endpoint: "usage_report", keyKind: "admin" },
      ),
    ).rejects.toThrow(/capability mismatch/u);

    expect(calls).toHaveLength(0);
  });

  it("rejects an unknown endpoint WITHOUT issuing a request", async () => {
    const { calls, fetchImpl } = recordingFetch();

    await expect(
      anthropicRequest(
        { credentials, fetchImpl },
        { endpoint: "nope", keyKind: "admin" },
      ),
    ).rejects.toThrow(/unknown Anthropic endpoint/u);

    expect(calls).toHaveLength(0);
  });

  it("never puts a credential in the URL", async () => {
    const { calls, fetchImpl } = recordingFetch();

    await anthropicRequest(
      { credentials, fetchImpl },
      { endpoint: "organization", keyKind: "admin" },
    );

    expect(calls[0].url).not.toContain("admin-key");
    expect(calls[0].url).not.toContain("analytics-key");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/connectors && npx vitest run src/providers/anthropic/request.test.ts`
Expected: FAIL — cannot resolve `./request.js`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/connectors/src/providers/anthropic/request.ts
import type { AnthropicCredentials } from "./credentials.js";
import { credentialFor } from "./credentials.js";
import { anthropicEndpoint, type AnthropicKeyKind } from "./endpoints.js";

export const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
export const ANTHROPIC_API_VERSION = "2023-06-01";
const USER_AGENT = "Ledger-Connector/1.0";
const REQUEST_TIMEOUT_MS = 30_000;

export async function anthropicRequest(
  dependencies: {
    readonly credentials: AnthropicCredentials;
    readonly fetchImpl: typeof fetch;
  },
  input: {
    readonly endpoint: string;
    readonly keyKind: AnthropicKeyKind;
    readonly init?: RequestInit;
  },
): Promise<Response> {
  // Resolution and the capability check both happen before any network call.
  const endpoint = anthropicEndpoint(input.endpoint);
  if (endpoint.keyKind !== input.keyKind) {
    throw new Error(
      `Anthropic capability mismatch: ${endpoint.name} requires ` +
        `${endpoint.keyKind}, caller supplied ${input.keyKind}`,
    );
  }

  const headers = new Headers(input.init?.headers);
  headers.set("x-api-key", credentialFor(dependencies.credentials, endpoint));
  headers.set("anthropic-version", ANTHROPIC_API_VERSION);
  headers.set("accept", "application/json");
  headers.set("user-agent", USER_AGENT);
  if (endpoint.betaHeader !== null) {
    headers.set("anthropic-beta", endpoint.betaHeader);
  }

  return dependencies.fetchImpl(
    new URL(endpoint.path, ANTHROPIC_API_ORIGIN),
    {
      ...input.init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/connectors && npx vitest run src/providers/anthropic/request.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Verify the provider boundary holds**

```bash
cd /Users/fcolomas/Projects/smp
pnpm lint:provider-boundary
cd packages/connectors && npx vitest run src/providers && npx tsc --noEmit
```

Expected: all pass. The boundary lint is the AC-relevant one — it proves no vendor token leaked outside the exempt provider directory.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/providers/anthropic/request.ts packages/connectors/src/providers/anthropic/request.test.ts
git commit -m "feat(US-059): route Anthropic requests by capability, failing closed"
```

---

## Definition of Done

- [ ] `pnpm type-check`, `pnpm lint`, `pnpm build`, `pnpm test` all pass
- [ ] `pnpm lint:provider-boundary` passes — no vendor token outside `providers/anthropic/`
- [ ] Adversarial AC verification — each must be **discriminating**:
  - Analytics caller on an admin endpoint → throws **and** `fetch` was never called
  - Admin caller on an analytics endpoint → throws **and** `fetch` was never called
  - Unknown endpoint → throws **and** `fetch` was never called
  - Identical admin/analytics keys → rejected at construction, before any endpoint is reachable
  - No credential appears in a request URL
- [ ] Append `ac_pass`, `build_pass`, then `done` to `.nous-feedback.jsonl`
- [ ] Record completion actuals against the 75-minute estimate
- [ ] File the 45-minute checkpoint if Git-derived elapsed time crosses 45 with implementation incomplete

> **AC1 is NOT met when this story closes.** US-060 carries rate limiting and bounded retry. Report US-059 complete; do not report AC1 complete.

## Self-Review

**Spec coverage:** AC1's credential-separation half → Tasks 2 and 3; "endpoint-specific header policy" → Task 1's table plus Task 3's header block, with the beta slot built but null everywhere per source. AC1's rate-limit half is explicitly out of scope and flagged twice.

**Placeholders:** none — every step carries real code, real commands, expected output.

**Type consistency:** `AnthropicKeyKind` is defined once in `endpoints.ts` and imported by both other modules. `credentialFor` takes an `AnthropicEndpoint`, not a name. `anthropicRequest` takes the endpoint by name and resolves it, so the unknown-endpoint path is reachable and testable.

**Discrimination check:** every negative test asserts `calls).toHaveLength(0)`. Without it, an implementation that called `fetch` and then threw would pass — which is the exact class of non-discriminating verification that let a tenant-isolation defect through in the US-043 plan.
