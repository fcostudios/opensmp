**Work item:** US-043
**Readiness assessment:** docs/readiness/US-043.json
**Approved estimate:** 100 minutes

# Alert Log Acknowledgment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A group admin can acknowledge an alert from SCR-alerts, and the alert records who acknowledged it and when.

**Architecture:** A conditional `UPDATE ... WHERE acknowledged_at IS NULL` gives first-writer-wins semantics without a lock; the same transaction writes the `audit_log` row. Authorization is a pure policy function so it is testable without the framework, matching `createRegisterCsvDownload`. The row action is the only client component — the page stays a server component.

**Tech Stack:** Next.js 16 App Router (server components + server actions), raw `pg` (the alerts module's existing style — *not* Drizzle), zod via `@smp/contracts`, Vitest, `@smp/db/testing/postgres-container` for real-PostgreSQL integration tests, next-intl.

**Spec:** `docs/stories/sprint-3/r1_misc_us_043.md` and the TOON contract `docs/screens/SCR-alerts.json`

## Global Constraints

- **Only two columns may be written.** `V20260725180000__core_schema_register_integrity.sql:197` grants `ledger_app` exactly `UPDATE (acknowledged_by, acknowledged_at)` on `alert_event`. Touching any other column in an `UPDATE` fails at the database. **No migration is needed or permitted in this story.**
- **Tenant isolation is mandatory.** Every query touching `alert_event` filters by the actor's authorized scope. Reuse the scope predicate already used by `listAuthorizedAlertEvents`.
- **SCR-alerts is `group_admin`-only in R1** (AC3). Do not add a company-scoped surface — that requires a nav-map change and is an open question in Step 9.
- **Never mock code we own** (`docs/dev-guide/TESTING.md` §1). The repository test uses the real PostgreSQL fixture.
- **Commit messages must reference `US-043` and no other work ID.** Every referenced ID is independently enforced; naming another (e.g. `US-042`) makes the commit try to authorize under it and it will be rejected.
- **Do not restate AC2/AC3 as new work.** Both are already satisfied — they get regression assertions only.

## Already Done — Do Not Rebuild

Verified before planning:

| Thing | Where |
|---|---|
| `acknowledged_by` / `acknowledged_at` columns | `packages/db/src/schema.ts` `alertEvent` |
| Column-level UPDATE grant | `V20260725180000__core_schema_register_integrity.sql:197` |
| Tabs (sin reconocer / todas) + counts | `apps/web/src/app/(authenticated)/alertas/page.tsx:55,92-99` |
| **AC2** per-type subject link dispatch | `apps/web/src/components/alerts/alert-list.tsx` → `alertSubjectDestination` |
| **AC3** alcance column | `page.tsx:85-88` → `alertScopeText` |
| Read path (list, count, cursor) | `apps/web/src/modules/operational-alert-read.ts` |

**The only gap is the write path and its row action.**

---

### Task 1: `ackAlert` input contract

**Files:**
- Create: `packages/contracts/src/alert-acknowledgment.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from "./alert-acknowledgment";` beside the other `export *` lines)
- Test: `packages/contracts/src/alert-acknowledgment.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ackAlertSchema` (zod), `type AckAlertInput = { alertEventId: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/contracts/src/alert-acknowledgment.test.ts
import { describe, expect, it } from "vitest";

import { ackAlertSchema } from "./alert-acknowledgment";

describe("ackAlertSchema", () => {
  it("accepts a uuid alert event id", () => {
    const parsed = ackAlertSchema.parse({
      alertEventId: "00000000-0000-4000-8000-000000004301",
    });
    expect(parsed).toEqual({
      alertEventId: "00000000-0000-4000-8000-000000004301",
    });
  });

  it("rejects a non-uuid id", () => {
    expect(ackAlertSchema.safeParse({ alertEventId: "al-001" }).success).toBe(false);
  });

  it("rejects unknown fields so a caller cannot smuggle an actor", () => {
    const result = ackAlertSchema.safeParse({
      alertEventId: "00000000-0000-4000-8000-000000004301",
      acknowledgedBy: "00000000-0000-4000-8000-000000004999",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx vitest run src/alert-acknowledgment.test.ts`
Expected: FAIL — cannot resolve `./alert-acknowledgment`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/contracts/src/alert-acknowledgment.ts
import { z } from "zod";

export const ackAlertSchema = z
  .object({
    alertEventId: z.string().uuid(),
  })
  .strict();

export type AckAlertInput = z.infer<typeof ackAlertSchema>;
```

Then add to `packages/contracts/src/index.ts`, alphabetically among the existing `export *` block:

```typescript
export * from "./alert-acknowledgment";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && npx vitest run src/alert-acknowledgment.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/alert-acknowledgment.ts packages/contracts/src/alert-acknowledgment.test.ts packages/contracts/src/index.ts
git commit -m "feat(US-043): add ackAlert input contract"
```

---

### Task 2: Repository acknowledgment with first-writer-wins and audit

**Files:**
- Modify: `apps/web/src/modules/alerts/repository.ts`
- Test: `apps/web/src/modules/alerts/repository.integration.test.ts` (append to the existing suite; reuse its `fixture`, `ids`, and `authorization()` helpers)

**Interfaces:**
- Consumes: `AckAlertInput` (Task 1); `LedgerAuthorization` from `../identity-access/authorization`
- Produces: on `AlertRepository`:
  ```typescript
  acknowledgeEvent(input: {
    readonly alertEventId: string;
    readonly actorUserAccountId: string;
    readonly authorization: LedgerAuthorization;
    readonly occurredAt: Date;
  }): Promise<
    | { readonly status: "acknowledged"; readonly acknowledgedBy: string; readonly acknowledgedAt: Date }
    | { readonly status: "already_acknowledged"; readonly acknowledgedBy: string; readonly acknowledgedAt: Date }
    | { readonly status: "not_found" }
  >;
  ```

`not_found` covers both "no such event" and "outside your scope" deliberately — a caller must not be able to probe for the existence of another tenant's alert.

> **Correction (found during Task 2 implementation, confirmed by the plan author):**
> Two defects in this task's sample code, both fixed in the actual implementation
> commit rather than in this text:
> 1. **Step 1** samples call `createAlertRepository(fixture.connectionString)`.
>    `PostgresFixture` has no `connectionString` field — only `appUrl`
>    (`packages/db/src/testing/postgres-container.ts:18-24`), which the existing
>    suite already uses throughout. Use `fixture.appUrl`.
> 2. **Step 3**'s sample scope predicate — `rule.scope_kind = 'global' OR
>    rule.company_id = ANY($2::uuid[])` — is a real tenant/role-isolation gap: it
>    drops both the `includeGlobal` boolean gate *and* the `scope_kind = 'company'`
>    qualifier that the actual predicate in `operational-alert-read.ts:192-195`
>    uses for the identical check, so it lets any authenticated caller (not just
>    `group_admin`) acknowledge a global-scope alert, and lets a global-scope rule
>    with a matching `company_id` slip through the company arm too. This
>    contradicts this task's own Global Constraint above ("reuse the scope
>    predicate already used by `listAuthorizedAlertEvents`"). The plan's own
>    adversarial DoD check (acknowledge an out-of-scope alert) does not catch this
>    — it only seeds a company-scoped alert in a different company, never a
>    global-scope one, so this would have shipped unnoticed. The implementation
>    uses the same `includeGlobal`-gated, scope-kind-qualified predicate as the
>    read path instead, gated by `authorization.globalRole === "group_admin"`, and
>    adds a test that fails under this text's literal predicate and passes under
>    the fix. See the `deviation` event in `.nous-feedback.jsonl` and commit
>    `f65097e` for the corrected SQL.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/modules/alerts/repository.integration.test.ts`:

```typescript
describe("acknowledgeEvent", () => {
  const admin = authorization([ids.companyA], "group_admin");
  const actor = "00000000-0000-4000-8000-000000004301";
  const at = new Date("2026-08-15T12:00:00.000Z");

  it("records who acknowledged and when", async () => {
    const repository = createAlertRepository(fixture.connectionString);
    try {
      const event = await seedAlertEvent(ids.ruleA, ids.companyA);
      const result = await repository.acknowledgeEvent({
        alertEventId: event,
        actorUserAccountId: actor,
        authorization: admin,
        occurredAt: at,
      });

      expect(result).toEqual({
        status: "acknowledged",
        acknowledgedBy: actor,
        acknowledgedAt: at,
      });
      const row = await readPool.query(
        "SELECT acknowledged_by::text, acknowledged_at FROM alert_event WHERE id = $1",
        [event],
      );
      expect(row.rows[0].acknowledged_by).toBe(actor);
      expect(row.rows[0].acknowledged_at).toEqual(at);
    } finally {
      await repository.close();
    }
  });

  it("keeps the first acknowledger when a second admin acknowledges", async () => {
    const repository = createAlertRepository(fixture.connectionString);
    const second = "00000000-0000-4000-8000-000000004302";
    try {
      const event = await seedAlertEvent(ids.ruleA, ids.companyA);
      await repository.acknowledgeEvent({
        alertEventId: event, actorUserAccountId: actor,
        authorization: admin, occurredAt: at,
      });

      const result = await repository.acknowledgeEvent({
        alertEventId: event,
        actorUserAccountId: second,
        authorization: admin,
        occurredAt: new Date("2026-08-15T13:00:00.000Z"),
      });

      expect(result).toEqual({
        status: "already_acknowledged",
        acknowledgedBy: actor,
        acknowledgedAt: at,
      });
    } finally {
      await repository.close();
    }
  });

  it("writes exactly one audit row for the first acknowledgment", async () => {
    const repository = createAlertRepository(fixture.connectionString);
    try {
      const event = await seedAlertEvent(ids.ruleA, ids.companyA);
      await repository.acknowledgeEvent({
        alertEventId: event, actorUserAccountId: actor,
        authorization: admin, occurredAt: at,
      });
      await repository.acknowledgeEvent({
        alertEventId: event, actorUserAccountId: actor,
        authorization: admin, occurredAt: at,
      });

      const audit = await readPool.query(
        `SELECT action, entity_type, actor_user_id::text
         FROM audit_log WHERE entity_id = $1`,
        [event],
      );
      expect(audit.rows).toEqual([
        { action: "alert.acknowledged", entity_type: "AlertEvent", actor_user_id: actor },
      ]);
    } finally {
      await repository.close();
    }
  });

  it("does not acknowledge an alert outside the actor's scope", async () => {
    const repository = createAlertRepository(fixture.connectionString);
    try {
      const event = await seedAlertEvent(ids.ruleB, ids.companyB);
      const result = await repository.acknowledgeEvent({
        alertEventId: event,
        actorUserAccountId: actor,
        authorization: authorization([ids.companyA]),
        occurredAt: at,
      });

      expect(result).toEqual({ status: "not_found" });
      const row = await readPool.query(
        "SELECT acknowledged_at FROM alert_event WHERE id = $1",
        [event],
      );
      expect(row.rows[0].acknowledged_at).toBeNull();
    } finally {
      await repository.close();
    }
  });
});
```

Add this helper next to the existing `authorization()` helper in the same file:

```typescript
async function seedAlertEvent(ruleId: string, companyId: string): Promise<string> {
  const id = randomUUID();
  await readPool.query(
    `INSERT INTO alert_event (id, alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
     VALUES ($1, $2, now(), $3::jsonb, '{"status":"pending"}'::jsonb, $4)`,
    [id, ruleId, JSON.stringify({ requestId: companyId }), `ack-test-${id}`],
  );
  return id;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/modules/alerts/repository.integration.test.ts -t acknowledgeEvent`
Expected: FAIL — `repository.acknowledgeEvent is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `apps/web/src/modules/alerts/repository.ts`. Import `LedgerAuthorization` and the existing scope helper the read path uses; if the scope predicate is not yet exported from `../operational-alert-read`, export it there rather than duplicating the SQL.

```typescript
async acknowledgeEvent({ alertEventId, actorUserAccountId, authorization, occurredAt }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Scope first: an out-of-scope id must be indistinguishable from a missing one.
    const scoped = await client.query<{ id: string }>(
      `SELECT event.id::text AS id
       FROM alert_event event
       JOIN alert_rule rule ON rule.id = event.alert_rule_id
       WHERE event.id = $1::uuid
         AND (rule.scope_kind = 'global' OR rule.company_id = ANY($2::uuid[]))`,
      [alertEventId, [...authorization.companyIds]],
    );
    if (scoped.rows.length === 0) {
      await client.query("ROLLBACK");
      return { status: "not_found" as const };
    }

    // Only the two granted columns are written, and only while unacknowledged.
    const updated = await client.query<{ by: string; at: Date }>(
      `UPDATE alert_event
       SET acknowledged_by = $2::uuid, acknowledged_at = $3
       WHERE id = $1::uuid AND acknowledged_at IS NULL
       RETURNING acknowledged_by::text AS by, acknowledged_at AS at`,
      [alertEventId, actorUserAccountId, occurredAt],
    );

    if (updated.rows.length === 0) {
      const existing = await client.query<{ by: string; at: Date }>(
        `SELECT acknowledged_by::text AS by, acknowledged_at AS at
         FROM alert_event WHERE id = $1::uuid`,
        [alertEventId],
      );
      await client.query("COMMIT");
      return {
        status: "already_acknowledged" as const,
        acknowledgedBy: existing.rows[0].by,
        acknowledgedAt: existing.rows[0].at,
      };
    }

    await client.query(
      `INSERT INTO audit_log
         (actor_user_id, action, entity_type, entity_id, company_id, before, after, occurred_at)
       SELECT $2::uuid, 'alert.acknowledged', 'AlertEvent', event.id, rule.company_id,
              '{"acknowledged_at":null}'::jsonb,
              jsonb_build_object('acknowledged_by', $2::text, 'acknowledged_at', $3::text),
              $3
       FROM alert_event event
       JOIN alert_rule rule ON rule.id = event.alert_rule_id
       WHERE event.id = $1::uuid`,
      [alertEventId, actorUserAccountId, occurredAt],
    );
    await client.query("COMMIT");
    return {
      status: "acknowledged" as const,
      acknowledgedBy: updated.rows[0].by,
      acknowledgedAt: updated.rows[0].at,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
},
```

Add the matching signature to the `AlertRepository` type (see **Interfaces** above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/modules/alerts/repository.integration.test.ts`
Expected: PASS — the four new tests plus every pre-existing test in the file

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/alerts/repository.ts apps/web/src/modules/alerts/repository.integration.test.ts
git commit -m "feat(US-043): acknowledge alerts with first-writer-wins and audit"
```

> **CHECKPOINT — 45 minutes.** Append a `checkpoint` event to `.nous-feedback.jsonl` per `docs/dev-guide/WORK_READINESS.md`. If you are materially past 45 minutes here, stop and report rather than continuing silently.

---

### Task 3: Authorization policy core

**Files:**
- Create: `apps/web/src/modules/alerts/ack-alert-policy.ts`
- Test: `apps/web/src/modules/alerts/ack-alert-policy.test.ts`

**Interfaces:**
- Consumes: `ackAlertSchema` (Task 1); `AlertRepository["acknowledgeEvent"]` (Task 2)
- Produces:
  ```typescript
  type AckAlertResult =
    | { readonly ok: true; readonly acknowledgedBy: string; readonly acknowledgedAt: string }
    | { readonly ok: false; readonly error: "forbidden" | "invalid" | "not_found" };

  function ackAlertPolicy(dependencies: {
    readonly authorization: LedgerAuthorization | null;
    readonly acknowledge: AlertRepository["acknowledgeEvent"];
    readonly now: () => Date;
  }, input: unknown): Promise<AckAlertResult>;
  ```

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/modules/alerts/ack-alert-policy.test.ts
import { describe, expect, it, vi } from "vitest";

import { ackAlertPolicy } from "./ack-alert-policy";
import type { LedgerAuthorization } from "../identity-access/authorization";

const at = new Date("2026-08-15T12:00:00.000Z");
const eventId = "00000000-0000-4000-8000-000000004301";
const actor = "00000000-0000-4000-8000-000000004401";

function admin(globalRole: LedgerAuthorization["globalRole"]): LedgerAuthorization {
  return {
    companyGrants: [], companyIds: [], employeeCompanyId: null,
    globalRole, idpSubject: "subject", roles: [], userAccountId: actor, userId: actor,
  } as unknown as LedgerAuthorization;
}

describe("ackAlertPolicy", () => {
  it("acknowledges for a group admin", async () => {
    const acknowledge = vi.fn().mockResolvedValue({
      status: "acknowledged", acknowledgedBy: actor, acknowledgedAt: at,
    });
    const result = await ackAlertPolicy(
      { authorization: admin("group_admin"), acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({
      ok: true, acknowledgedBy: actor, acknowledgedAt: at.toISOString(),
    });
  });

  it("rejects a non group admin without touching the repository", async () => {
    const acknowledge = vi.fn();
    const result = await ackAlertPolicy(
      { authorization: admin("central_finance"), acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller without touching the repository", async () => {
    const acknowledge = vi.fn();
    const result = await ackAlertPolicy(
      { authorization: null, acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before authorizing the repository call", async () => {
    const acknowledge = vi.fn();
    const result = await ackAlertPolicy(
      { authorization: admin("group_admin"), acknowledge, now: () => at },
      { alertEventId: "al-001" },
    );
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("reports an out-of-scope alert as not found", async () => {
    const acknowledge = vi.fn().mockResolvedValue({ status: "not_found" });
    const result = await ackAlertPolicy(
      { authorization: admin("group_admin"), acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("treats a replayed acknowledgment as success with the original acknowledger", async () => {
    const acknowledge = vi.fn().mockResolvedValue({
      status: "already_acknowledged", acknowledgedBy: actor, acknowledgedAt: at,
    });
    const result = await ackAlertPolicy(
      { authorization: admin("group_admin"), acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({
      ok: true, acknowledgedBy: actor, acknowledgedAt: at.toISOString(),
    });
  });
});
```

`vi.fn()` here stands in for a *collaborator boundary this task owns the contract of*, not for code under test — Task 2 already proves the real repository behavior against real PostgreSQL.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/modules/alerts/ack-alert-policy.test.ts`
Expected: FAIL — cannot resolve `./ack-alert-policy`

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/modules/alerts/ack-alert-policy.ts
import { ackAlertSchema } from "@smp/contracts";

import type { LedgerAuthorization } from "../identity-access/authorization";
import type { AlertRepository } from "./repository";

export type AckAlertResult =
  | { readonly ok: true; readonly acknowledgedBy: string; readonly acknowledgedAt: string }
  | { readonly ok: false; readonly error: "forbidden" | "invalid" | "not_found" };

export async function ackAlertPolicy(
  dependencies: {
    readonly authorization: LedgerAuthorization | null;
    readonly acknowledge: AlertRepository["acknowledgeEvent"];
    readonly now: () => Date;
  },
  input: unknown,
): Promise<AckAlertResult> {
  const { authorization } = dependencies;
  if (!authorization || authorization.globalRole !== "group_admin") {
    return { ok: false, error: "forbidden" };
  }
  const parsed = ackAlertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const result = await dependencies.acknowledge({
    alertEventId: parsed.data.alertEventId,
    actorUserAccountId: authorization.userAccountId,
    authorization,
    occurredAt: dependencies.now(),
  });
  if (result.status === "not_found") return { ok: false, error: "not_found" };
  return {
    ok: true,
    acknowledgedBy: result.acknowledgedBy,
    acknowledgedAt: result.acknowledgedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/modules/alerts/ack-alert-policy.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/alerts/ack-alert-policy.ts apps/web/src/modules/alerts/ack-alert-policy.test.ts
git commit -m "feat(US-043): add ackAlert authorization policy core"
```

---

### Task 4: Server action adapter and the Reconocer row action

**Files:**
- Create: `apps/web/src/modules/alerts/actions.ts` (`"use server"`)
- Create: `apps/web/src/components/alerts/acknowledge-alert-button.tsx` (`"use client"`)
- Test: `apps/web/src/components/alerts/acknowledge-alert-button.test.tsx`
- Modify: `apps/web/messages/es-EC.json`, `apps/web/messages/en-US.json`

**Interfaces:**
- Consumes: `ackAlertPolicy` (Task 3)
- Produces: `ackAlert(input: unknown): Promise<AckAlertResult>`; `<AcknowledgeAlertButton alertEventId labels onAcknowledged? />`

TOON contract (`docs/screens/SCR-alerts.json`, `rowActions[0]`) — implement verbatim:
`id: act_reconocer`, `label: "Reconocer"`, `variant: primary`, `visibleWhen: row.acknowledged_at == null`, confirm title `"Reconocer alerta"`, confirm body `"Vas a marcar esta alerta como revisada. Quedará registrado tu usuario y la hora."`, on success toast `"Alerta reconocida. Gracias por revisarla."` and `refresh: true`.

- [ ] **Step 1: Add the i18n keys**

Add under the existing `"alerts"` object in **both** message files. `en-US.json`:

```json
"acknowledge": {
  "action": "Acknowledge",
  "confirmTitle": "Acknowledge alert",
  "confirmBody": "You are marking this alert as reviewed. Your user and the time will be recorded.",
  "confirm": "Acknowledge",
  "cancel": "Cancel",
  "success": "Alert acknowledged. Thanks for reviewing it.",
  "error": "We couldn't acknowledge the alert."
}
```

`es-EC.json` — the TOON strings are authoritative here, copy exactly:

```json
"acknowledge": {
  "action": "Reconocer",
  "confirmTitle": "Reconocer alerta",
  "confirmBody": "Vas a marcar esta alerta como revisada. Quedará registrado tu usuario y la hora.",
  "confirm": "Reconocer",
  "cancel": "Cancelar",
  "success": "Alerta reconocida. Gracias por revisarla.",
  "error": "No pudimos reconocer la alerta."
}
```

- [ ] **Step 2: Write the failing component test**

```typescript
// apps/web/src/components/alerts/acknowledge-alert-button.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AcknowledgeAlertButton } from "./acknowledge-alert-button";

const labels = {
  action: "Reconocer",
  confirmTitle: "Reconocer alerta",
  confirmBody: "Vas a marcar esta alerta como revisada. Quedará registrado tu usuario y la hora.",
  confirm: "Reconocer",
  cancel: "Cancelar",
  success: "Alerta reconocida. Gracias por revisarla.",
  error: "No pudimos reconocer la alerta.",
};
const eventId = "00000000-0000-4000-8000-000000004301";

describe("AcknowledgeAlertButton", () => {
  it("does not acknowledge until the confirmation is accepted", () => {
    const acknowledge = vi.fn();
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));

    expect(screen.getByText(labels.confirmBody)).toBeDefined();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("acknowledges and reports success after confirmation", async () => {
    const acknowledge = vi.fn().mockResolvedValue({
      ok: true, acknowledgedBy: "actor", acknowledgedAt: "2026-08-15T12:00:00.000Z",
    });
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));
    fireEvent.click(screen.getByTestId("act_reconocer_confirm"));

    expect(acknowledge).toHaveBeenCalledWith({ alertEventId: eventId });
    expect(await screen.findByText(labels.success)).toBeDefined();
  });

  it("surfaces a failure without claiming success", async () => {
    const acknowledge = vi.fn().mockResolvedValue({ ok: false, error: "not_found" });
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));
    fireEvent.click(screen.getByTestId("act_reconocer_confirm"));

    expect(await screen.findByText(labels.error)).toBeDefined();
    expect(screen.queryByText(labels.success)).toBeNull();
  });

  it("abandons the acknowledgment when the confirmation is cancelled", () => {
    const acknowledge = vi.fn();
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));
    fireEvent.click(screen.getByTestId("act_reconocer_cancel"));

    expect(acknowledge).not.toHaveBeenCalled();
    expect(screen.queryByText(labels.confirmBody)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/components/alerts/acknowledge-alert-button.test.tsx`
Expected: FAIL — cannot resolve `./acknowledge-alert-button`

- [ ] **Step 4: Write the client component**

The `acknowledge` prop is injected so the component is testable without the server-action runtime; the page passes the real `ackAlert`.

```typescript
// apps/web/src/components/alerts/acknowledge-alert-button.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export interface AcknowledgeAlertLabels {
  readonly action: string;
  readonly confirmTitle: string;
  readonly confirmBody: string;
  readonly confirm: string;
  readonly cancel: string;
  readonly success: string;
  readonly error: string;
}

export function AcknowledgeAlertButton({
  acknowledge,
  alertEventId,
  labels,
}: {
  readonly acknowledge: (input: { alertEventId: string }) => Promise<{ ok: boolean }>;
  readonly alertEventId: string;
  readonly labels: AcknowledgeAlertLabels;
}) {
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<"success" | "error" | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (outcome !== null) {
    return (
      <p role="status" className="text-sm text-text-secondary">
        {outcome === "success" ? labels.success : labels.error}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        className="rounded bg-primary px-3 py-2 text-sm font-semibold text-text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        data-testid="act_reconocer"
        onClick={() => setConfirming(true)}
        type="button"
      >
        {labels.action}
      </button>
    );
  }

  return (
    <div className="space-y-2" role="group" aria-label={labels.confirmTitle}>
      <p className="text-sm text-text-secondary">{labels.confirmBody}</p>
      <button
        className="rounded bg-primary px-3 py-2 text-sm font-semibold text-text-on-primary"
        data-testid="act_reconocer_confirm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await acknowledge({ alertEventId });
            setOutcome(result.ok ? "success" : "error");
            if (result.ok) router.refresh();
          });
        }}
        type="button"
      >
        {labels.confirm}
      </button>
      <button
        className="rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary"
        data-testid="act_reconocer_cancel"
        onClick={() => setConfirming(false)}
        type="button"
      >
        {labels.cancel}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/components/alerts/acknowledge-alert-button.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the server action adapter**

```typescript
// apps/web/src/modules/alerts/actions.ts
"use server";

import { ackAlertPolicy, type AckAlertResult } from "./ack-alert-policy";
import { createAlertRepository } from "./repository";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";

export async function ackAlert(input: unknown): Promise<AckAlertResult> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const authorization = await loadCurrentLedgerAuthorization();
  const repository = createAlertRepository(process.env.DATABASE_URL);
  try {
    return await ackAlertPolicy(
      {
        authorization,
        acknowledge: repository.acknowledgeEvent,
        now: () => new Date(),
      },
      input,
    );
  } finally {
    await repository.close();
  }
}
```

- [ ] **Step 7: Run the alerts suites**

Run: `cd apps/web && npx vitest run src/components/alerts src/modules/alerts`
Expected: PASS, no unhandled rejections

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/modules/alerts/actions.ts apps/web/src/components/alerts/acknowledge-alert-button.tsx apps/web/src/components/alerts/acknowledge-alert-button.test.tsx apps/web/messages/es-EC.json apps/web/messages/en-US.json
git commit -m "feat(US-043): add Reconocer row action and ackAlert server action"
```

> **CHECKPOINT — 90 minutes.** Append a second `checkpoint` event. Only Task 5 should remain; if more remains, report the variance rather than absorbing it silently.

---

### Task 5: Wire the row action into the list and lock in AC2/AC3

**Files:**
- Modify: `packages/ui/src/organisms/alert-list.tsx`
- Modify: `apps/web/src/components/alerts/alert-list.tsx`
- Modify: `apps/web/src/app/(authenticated)/alertas/page.tsx`
- Test: `packages/ui/src/organisms/alert-list.test.tsx`, `apps/web/src/components/alerts/alert-list.test.tsx`

**Interfaces:**
- Consumes: `AcknowledgeAlertButton` (Task 4)
- Produces: `AlertListProps.renderRowAction?: (item: AlertListItem) => ReactNode`

- [ ] **Step 1: Write the failing organism test**

Append to `packages/ui/src/organisms/alert-list.test.tsx`:

```typescript
it("renders a row action only for unacknowledged rows", () => {
  render(
    <AlertList
      {...baseProps}
      items={[
        { ...baseItem, id: "open", acknowledgedAt: null, acknowledgedBy: null },
        { ...baseItem, id: "closed", acknowledgedAt: "2026-08-15T12:00:00.000Z", acknowledgedBy: "Ana" },
      ]}
      renderRowAction={(item) => <button data-testid={`ack-${item.id}`}>ack</button>}
    />,
  );

  expect(screen.getByTestId("ack-open")).toBeDefined();
  expect(screen.queryByTestId("ack-closed")).toBeNull();
});
```

Reuse the file's existing `baseProps` / `baseItem` fixtures; if they are inline in other tests, extract them to consts first without changing assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/organisms/alert-list.test.tsx -t "row action"`
Expected: FAIL — `renderRowAction` is not a prop and no action cell renders

- [ ] **Step 3: Add the action column to the organism**

In `packages/ui/src/organisms/alert-list.tsx` add to `AlertListProps`:

```typescript
readonly renderRowAction?: (item: AlertListItem) => ReactNode;
```

Add a trailing header cell inside the existing `<tr>` in `<thead>`:

```tsx
{renderRowAction ? <th className="px-3 py-2 font-medium" scope="col" /> : null}
```

Add the matching trailing cell inside the row `map`, enforcing the TOON `visibleWhen: row.acknowledged_at == null`:

```tsx
{renderRowAction ? (
  <td className="px-3 py-3">
    {item.acknowledgedAt === null ? renderRowAction(item) : null}
  </td>
) : null}
```

Bump the empty-state `colSpan` from `7` to `renderRowAction ? 8 : 7`, and add `import type { ReactNode } from "react";`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/organisms/alert-list.test.tsx`
Expected: PASS, including every pre-existing test in the file

- [ ] **Step 5: Add the AC2 and AC3 regression assertions**

These lock in behavior that already works so a later refactor cannot silently drop it. Append to `apps/web/src/components/alerts/alert-list.test.tsx`:

```typescript
it("AC2: dispatches each alert type to its own subject destination", () => {
  expect(alertDestination("low_pool", {
    licenseTypeId: "lt-1", vendorAccountId: "va-1",
  })).toBe("/cupos?vendorAccountId=va-1&licenseTypeId=lt-1");
  expect(alertDestination("approval_aging", { requestId: "req-1" }))
    .toBe("/solicitudes/req-1");
  expect(alertDestination("credential_failure", { vendorAccountId: "va-1" }))
    .toBe("/credenciales");
  expect(alertDestination("register_drift", { reconciliationId: "rec-1" }))
    .toBe("/excepciones");
  expect(alertDestination("nonsense", { requestId: "req-1" })).toBeNull();
});

it("AC3: labels company scope by name and falls back to global", () => {
  const labels = { company: (name: string) => `Compañía: ${name}`, global: "Global" };
  expect(alertScopeText("company", "Corporativo", labels)).toBe("Compañía: Corporativo");
  expect(alertScopeText("global", null, labels)).toBe("Global");
});
```

Run: `cd apps/web && npx vitest run src/components/alerts/alert-list.test.tsx`
Expected: PASS. If any assertion fails, the destination table changed — fix the assertion against `alertSubjectDestination`, do not change production code under this story.

- [ ] **Step 6: Wire the page**

In `apps/web/src/app/(authenticated)/alertas/page.tsx`, import the button and action:

```typescript
import { AcknowledgeAlertButton } from "@/components/alerts/acknowledge-alert-button";
import { ackAlert } from "@/modules/alerts/actions";
```

Pass to `<AlertList>` alongside the existing props:

```tsx
renderRowAction={(item) => (
  <AcknowledgeAlertButton
    acknowledge={ackAlert}
    alertEventId={item.id}
    labels={{
      action: t("acknowledge.action"),
      cancel: t("acknowledge.cancel"),
      confirm: t("acknowledge.confirm"),
      confirmBody: t("acknowledge.confirmBody"),
      confirmTitle: t("acknowledge.confirmTitle"),
      error: t("acknowledge.error"),
      success: t("acknowledge.success"),
    }}
  />
)}
```

Forward `renderRowAction` through the `AlertList` wrapper in `apps/web/src/components/alerts/alert-list.tsx` — it already spreads `...props`, so only the type needs to admit it.

- [ ] **Step 7: Full verification**

```bash
cd apps/web && npx vitest run src/components/alerts src/modules/alerts
cd ../.. && pnpm type-check && pnpm lint && pnpm build
pnpm readiness:check -- US-043
```

Expected: all green. `pnpm build` must succeed — `next build --webpack`; a client/server boundary mistake surfaces here and nowhere earlier.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/organisms/alert-list.tsx packages/ui/src/organisms/alert-list.test.tsx apps/web/src/components/alerts/alert-list.tsx apps/web/src/components/alerts/alert-list.test.tsx "apps/web/src/app/(authenticated)/alertas/page.tsx"
git commit -m "feat(US-043): wire Reconocer into the alert log"
```

---

## Definition of Done

Per `docs/dev-guide/DEFINITION_OF_DONE.md`, before any `done` event:

- [ ] `pnpm type-check`, `pnpm lint`, `pnpm build`, `pnpm test` all pass
- [ ] Adversarial AC verification — actively try to break each AC:
  - AC1: acknowledge twice concurrently; the first acknowledger must survive
  - AC1: acknowledge as `central_finance`; must be `forbidden` with no DB write
  - AC2/AC3: assertions above
  - Tenant isolation: acknowledge an out-of-scope alert; must be `not_found` with no write
- [ ] Append `ac_pass`, `build_pass`, then `done` to `.nous-feedback.jsonl`
- [ ] Record completion actuals against the 100-minute estimate

> `pnpm test` runs `readiness:check:all`, which is currently red on the **unsigned US-018/US-056/US-057/US-058 artifacts**. That is unrelated to this story but will block a truthful `build_pass`. If those signatures have not landed, report the variance — do not claim `build_pass`.

## Self-Review

**Spec coverage:** AC1 tabs → already done, asserted in Task 5; AC1 `ackAlert` who/when → Tasks 1-4; AC2 → Task 5 Step 5; AC3 → Task 5 Step 5 and the `visibleWhen` rule in Step 3. TOON `rowActions[0]` — id, label, variant, visibleWhen, confirm title/body, success toast, refresh — all in Tasks 4-5.

**Placeholders:** none — every step carries real code, real commands, and expected output.

**Type consistency:** `acknowledgeEvent` returns `Date`; `ackAlertPolicy` converts to ISO string at the boundary; the component consumes only `{ ok }`. `AlertListItem.acknowledgedAt` is `string | null`, which is what the `visibleWhen` check compares. `renderRowAction` is named identically in the organism, wrapper, and page.
