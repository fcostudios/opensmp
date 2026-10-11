import { evaluateInactivity, hasPositiveVendorActivity } from "@smp/domain/usage/inactivity";
import { createInactivityFlaggingRepository } from "../../../../packages/db/src/inactivity-flagging.js";
import { applyRequestTransitionInTransaction } from "@smp/db/request-transition";
import * as schema from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createInactivityFlaggingJob } from "./inactivity-flagging.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(740000 + n).padStart(12, "0")}`;
const ids = { admin: id(1), companyA: id(2), companyB: id(3), vendor: id(4), account: id(5), otherAccount: id(6), license: id(7) };
const at = new Date("2026-10-10T10:45:00Z");
const authored = { createdAt: at, createdBy: ids.admin };
let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let repository: ReturnType<typeof createInactivityFlaggingRepository>;
const personId = (n: number) => id(100 + n);
const requestId = (n: number) => id(200 + n);
const assignmentId = (n: number) => id(300 + n);

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  repository = createInactivityFlaggingRepository(drizzle(pool, { schema }), { evaluateInactivity, hasPositiveVendorActivity });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await owner?.end();
  await fixture?.stop();
});

beforeEach(async () => {
  await owner.query("TRUNCATE audit_log,request_transition,license_request,license_assignment,activity_record,reclamation_proposal,provisioning_action,person,vendor_account,license_type,vendor,company,user_account CASCADE");
  const db = drizzle(owner, { schema });
  await db.insert(schema.userAccount).values({ id: ids.admin, email: "flag-admin@test.invalid", idpSubject: "flag-admin", status: "active", createdAt: at });
  await db.insert(schema.company).values([
    { id: ids.companyA, name: "A", code: "FLAGA", type: "internal", status: "active", ...authored },
    { id: ids.companyB, name: "B", code: "FLAGB", type: "internal", status: "inactive", ...authored },
  ]);
  await db.insert(schema.vendor).values({ id: ids.vendor, name: "Vendor", connectorType: "orchestration", provisioningProtocol: "none", canProvision: false, canDeprovision: false, hasUsageData: true, hasCostData: false, identityMatching: "email", status: "active", ...authored });
  await db.insert(schema.vendorAccount).values([ids.account, ids.otherAccount].map(accountId => ({ id: accountId, vendorId: ids.vendor, name: accountId, mode: "orchestration" as const, lowPoolFloor: 1, status: "active" as const, ...authored })));
  await db.insert(schema.licenseType).values({ id: ids.license, vendorId: ids.vendor, name: "Seat", unit: "seat", status: "active", ...authored });
});

async function seed(n: number, options: { companyId?: string; state?: typeof schema.licenseRequest.$inferInsert.state; accountId?: string; ended?: boolean; anchor?: boolean } = {}) {
  const db = drizzle(owner, { schema });
  const companyId = options.companyId ?? ids.companyA;
  const accountId = options.accountId ?? ids.account;
  await db.insert(schema.person).values({ id: personId(n), email: `flag-${n}@test.invalid`, fullName: `Person ${n}`, companyId, status: "active", ...authored });
  await db.insert(schema.licenseRequest).values({ id: requestId(n), requestNo: `FLAG-${n}`, personId: personId(n), companyId, vendorAccountId: accountId, licenseTypeId: ids.license, state: options.state ?? "active", justification: "fixture", ...authored });
  await db.insert(schema.licenseAssignment).values({ id: assignmentId(n), personId: personId(n), companyId, vendorAccountId: accountId, licenseTypeId: ids.license, sourceRequestId: options.anchor === false ? null : requestId(n), startedOn: "2026-08-01", endedOn: options.ended ? "2026-10-01" : null, sourceKind: "import", ...authored });
}

async function activity(n: number, date: string, counters: unknown = { chat_metrics: { message_count: 1 } }, account = ids.account) {
  await drizzle(owner, { schema }).insert(schema.activityRecord).values({ personId: personId(n), vendorAccountId: account, activityDate: date, counters, source: "manual", syncedAt: at });
}
const run = () => repository.runForCompany({ companyId: ids.companyA, evaluationDate: "2026-10-10", occurredAt: at });
async function state(n: number) {
  return (await owner.query("SELECT state FROM license_request WHERE id=$1", [requestId(n)])).rows[0]?.state;
}
async function states(numbers: number[]) {
  const result = [];
  for (const n of numbers) result.push(await state(n));
  return result;
}
async function evidence(n: number) {
  const transitions = await owner.query("SELECT from_state,to_state,actor_user_id,note,occurred_at FROM request_transition WHERE request_id=$1", [requestId(n)]);
  const audits = await owner.query("SELECT action,actor_user_id,before,after,note,occurred_at FROM audit_log WHERE entity_id=$1", [requestId(n)]);
  return { transitions: transitions.rows, audits: audits.rows };
}

async function namedApp(name: string) {
  const client = await fixture.connectAsApp();
  await client.query("SELECT set_config('application_name',$1,false)", [name]);
  return client;
}
async function waitBlocked(name: string, blocker: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await owner.query("SELECT pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1", [name]);
    if (result.rows.some(row => row.blockers.includes(blocker))) return;
  }
  throw new Error(`Expected database lock wait: ${name} blocked by ${blocker}`);
}
async function pid(client: pg.Client): Promise<number> {
  return (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
}
function runOn(client: pg.Client) {
  return createInactivityFlaggingRepository(drizzle(client, { schema }), { evaluateInactivity, hasPositiveVendorActivity }).runForCompany({ companyId: ids.companyA, evaluationDate: "2026-10-10", occurredAt: at });
}
async function seedRace(unflag: boolean) {
  await seed(1, { state: unflag ? "flagged_inactive" : "active" });
  await seed(2, { companyId: ids.companyB });
  await activity(1, unflag ? "2026-10-06" : "2026-09-06");
  await activity(1, "2026-10-07", {});
}
async function assertForeignSentinel() {
  expect(await state(2)).toBe("active");
  expect(await evidence(2)).toEqual({ transitions: [], audits: [] });
}

describe("atomic lag-aware inactivity flagging", () => {
  it("flags only age31 against account data-through, preserves boundary/lag/no-data/other-state/tenant rows", async () => {
    for (let n = 1; n <= 9; n++) await seed(n, n === 6 ? { state: "offboarding" } : n === 7 ? { ended: true } : n === 8 ? { anchor: false } : n === 9 ? { companyId: ids.companyB } : {});
    await activity(1, "2026-09-06");
    await activity(1, "2026-10-07", { chat_metrics: { message_count: 0 } });
    await activity(2, "2026-09-07");
    await activity(3, "2026-09-08");
    await activity(4, "2026-10-07", { session_count: 100, cowork_metrics: null });
    for (const n of [6,7,8,9]) await activity(n, "2026-09-06");
    expect(await run()).toBe(1);
    expect(await states([1,2,3,4,5,6,7,8,9])).toEqual(["flagged_inactive","active","active","active","active","offboarding","active","active","active"]);
    const actual = await evidence(1);
    expect(actual.transitions).toHaveLength(1);
    expect(actual.transitions[0]).toMatchObject({ from_state: "active", to_state: "flagged_inactive", actor_user_id: null, occurred_at: at });
    expect(actual.audits).toHaveLength(1);
    expect(actual.audits[0]).toMatchObject({ action: "request.flagged_inactive", actor_user_id: null, before: { state: "active" }, after: { state: "flagged_inactive" }, occurred_at: at });
    expect(actual.audits[0].note).toContain("dataThrough=2026-10-07; lastActivity=2026-09-06");
    expect(await evidence(9)).toEqual({ transitions: [], audits: [] });
    expect((await owner.query("SELECT (SELECT count(*)::int FROM reclamation_proposal) AS proposals,(SELECT count(*)::int FROM provisioning_action) AS actions,(SELECT count(*)::int FROM license_assignment WHERE ended_on IS NOT NULL) AS ended")).rows[0]).toEqual({ proposals: 0, actions: 0, ended: 1 });
    expect(await run()).toBe(0);
    expect(await evidence(1)).toEqual(actual);
  });

  it("unflags only known resumed activity and leaves no_data flagged; repeated job is unchanged", async () => {
    await seed(1); await seed(2, { state: "flagged_inactive" });
    await activity(1, "2026-09-06"); await activity(1, "2026-10-07", { chat_metrics: null });
    expect(await run()).toBe(1);
    await activity(1, "2026-10-08", { cowork_metrics: { sessions_with_file_edits_count: 1 } });
    const poolCount = async () => (await owner.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND usename='ledger_app' AND application_name='flag-resource-close'", [fixture.databaseName])).rows[0].count;
    const connectionsBefore = await poolCount();
    const resourceUrl = new URL(fixture.appUrl);
    resourceUrl.searchParams.set("application_name", "flag-resource-close");
    const job = createInactivityFlaggingJob({ connectionString: resourceUrl.toString() });
    try {
      expect(await job.drain(at)).toEqual({ processed: 1 });
      expect(await poolCount()).toBe(1);
      expect(await state(1)).toBe("active");
      expect(await state(2)).toBe("flagged_inactive");
      const before = await evidence(1);
      expect(before.transitions).toHaveLength(2);
      expect(before.transitions.find(row => row.to_state === "active")).toMatchObject({ from_state: "flagged_inactive", to_state: "active", actor_user_id: null, occurred_at: at });
      expect(before.audits.map(row => row.action).sort()).toEqual(["request.active", "request.flagged_inactive"]);
      expect(await job.drain(at)).toEqual({ processed: 0 });
      expect(await evidence(1)).toEqual(before);
      expect(await evidence(2)).toEqual({ transitions: [], audits: [] });
      await expect(job.drain(new Date("invalid"))).rejects.toThrow("Invalid inactivity flagging timestamp");
    } finally { await job.close(); }
    expect(await poolCount()).toBe(connectionsBefore);
  });

  it("never borrows activity from another account and enumerates inactive companies", async () => {
    await seed(1); await seed(2, { companyId: ids.companyB });
    await activity(1, "2026-09-06"); await activity(1, "2026-10-07", {});
    await activity(1, "2026-10-09", undefined, ids.otherAccount);
    await activity(2, "2026-09-06");
    const job = createInactivityFlaggingJob({ connectionString: fixture.appUrl });
    try { expect(await job.drain(at)).toEqual({ processed: 2 }); }
    finally { await job.close(); }
    expect(await states([1,2])).toEqual(["flagged_inactive","flagged_inactive"]);
    expect((await evidence(2)).audits).toHaveLength(1);
  });

  it("skips anchors whose holder or account no longer matches the assignment", async () => {
    await seed(1); await seed(2); await seed(3);
    await activity(1, "2026-09-06"); await activity(2, "2026-09-06");
    await activity(3, "2026-10-07", {});
    await owner.query("UPDATE license_assignment SET source_request_id=$1 WHERE id=$2", [requestId(3), assignmentId(1)]);
    await owner.query("UPDATE license_request SET vendor_account_id=$1 WHERE id=$2", [ids.otherAccount, requestId(2)]);
    expect(await run()).toBe(0);
    expect(await states([1,2,3])).toEqual(["active","active","active"]);
    for (const n of [1,2,3]) expect(await evidence(n)).toEqual({ transitions: [], audits: [] });
    expect((await owner.query("SELECT count(*)::int AS count FROM license_assignment WHERE ended_on IS NOT NULL")).rows[0].count).toBe(0);
  });

  it("rejects an invalid injected repository timestamp before writing an eligible request", async () => {
    await seedRace(false);
    await expect(repository.runForCompany({ companyId: ids.companyA, evaluationDate: "2026-10-10", occurredAt: new Date("invalid") })).rejects.toThrow("Invalid inactivity flagging timestamp");
    expect(await state(1)).toBe("active");
    expect(await evidence(1)).toEqual({ transitions: [], audits: [] });
    await assertForeignSentinel();
  });

  it("rolls state and transition back when the audit insert fails", async () => {
    await seed(1); await activity(1, "2026-09-06"); await activity(1, "2026-10-07", {});
    await owner.query("CREATE FUNCTION flag_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'flag audit failure'; END $$; CREATE TRIGGER flag_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION flag_audit_failure()");
    try {
      await expect(run()).rejects.toThrow("flag audit failure");
      expect(await state(1)).toBe("active");
      expect(await evidence(1)).toEqual({ transitions: [], audits: [] });
      expect((await owner.query("SELECT count(*)::int AS count FROM reclamation_proposal")).rows[0].count).toBe(0);
    } finally { await owner.query("DROP TRIGGER flag_audit_failure ON audit_log; DROP FUNCTION flag_audit_failure()"); }
    expect(await run()).toBe(1);
  });
});


describe("real database lock-order races", () => {
  for (const unflag of [false, true]) {
    const initial = unflag ? "flagged_inactive" : "active";
    const target = unflag ? "active" : "flagged_inactive";
    it(`preserves manual offboarding when it wins against ${initial}->${target}`, async () => {
      await seedRace(unflag);
      const manual = await namedApp("flag-manual-wins");
      const worker = await namedApp("flag-manual-loser");
      let work: Promise<number | Error> | undefined;
      try {
        await manual.query("BEGIN");
        await manual.query("SELECT id FROM license_request WHERE id=$1 AND company_id=$2 FOR UPDATE", [requestId(1),ids.companyA]);
        work = runOn(worker).catch(error => error as Error);
        await waitBlocked("flag-manual-loser", await pid(manual));
        await applyRequestTransitionInTransaction(drizzle(manual, { schema }), { requestId: requestId(1), from: initial, to: "offboarding", actorUserId: ids.admin, note: "Manual winner", occurredAt: at }, { expectedCompanyId: ids.companyA });
        await manual.query("COMMIT");
        expect(await work).toBe(0);
        expect(await state(1)).toBe("offboarding");
        const actual = await evidence(1);
        expect(actual.transitions).toEqual([{ from_state: initial, to_state: "offboarding", actor_user_id: ids.admin, note: "Manual winner", occurred_at: at }]);
        expect(actual.audits).toEqual([{ action: "request.offboarding", actor_user_id: ids.admin, before: { state: initial }, after: { state: "offboarding" }, note: "Manual winner", occurred_at: at }]);
        await assertForeignSentinel();
      } finally {
        await manual.query("ROLLBACK"); await work; await manual.end(); await worker.end();
      }
    });

    it(`rejects the manual expected-${initial} transition after ${initial}->${target} wins`, async () => {
      await seedRace(unflag);
      const blocker = await fixture.connectAsOwner();
      const worker = await namedApp("flag-job-winner");
      const manual = await namedApp("flag-job-loser");
      const workerPid = await pid(worker);
      let work: Promise<number | Error> | undefined;
      let change: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN; LOCK TABLE audit_log IN SHARE MODE");
        work = runOn(worker).catch(error => error as Error);
        await waitBlocked("flag-job-winner", await pid(blocker));
        change = drizzle(manual, { schema }).transaction(tx => applyRequestTransitionInTransaction(tx, { requestId: requestId(1), from: initial, to: "offboarding", actorUserId: ids.admin, note: "Manual loser", occurredAt: at }, { expectedCompanyId: ids.companyA })).catch(error => error);
        await waitBlocked("flag-job-loser", workerPid);
        await blocker.query("COMMIT");
        expect(await work).toBe(1);
        expect(await change).toBeInstanceOf(Error);
        expect((await change as Error).message).toBe(`REQUEST_STATE_CONFLICT:${requestId(1)}:${initial}:${target}`);
        expect(await state(1)).toBe(target);
        const actual = await evidence(1);
        expect(actual.transitions).toHaveLength(1);
        expect(actual.transitions[0]).toMatchObject({ from_state: initial, to_state: target, actor_user_id: null, occurred_at: at });
        expect(actual.audits).toHaveLength(1);
        expect(actual.audits[0]).toMatchObject({ action: `request.${target}`, actor_user_id: null, before: { state: initial }, after: { state: target }, occurred_at: at });
        await assertForeignSentinel();
      } finally {
        await blocker.query("ROLLBACK"); await work; await change;
        await blocker.end(); await worker.end(); await manual.end();
      }
    });
  }

  it("rechecks a closed assignment after waiting and permits the concurrent foreign-key KEY SHARE insert", async () => {
    await seedRace(false);
    const closer = await fixture.connectAsApp();
    const worker = await namedApp("flag-assignment-wait");
    let work: Promise<number | Error> | undefined;
    try {
      await closer.query("BEGIN");
      await closer.query("SELECT id FROM license_assignment WHERE id=$1 AND company_id=$2 FOR UPDATE", [assignmentId(1),ids.companyA]);
      work = runOn(worker).catch(error => error as Error);
      await waitBlocked("flag-assignment-wait", await pid(closer));
      // This real insert acquires FK KEY SHARE on the person while the worker
      // holds NO KEY UPDATE and waits for our assignment. FOR UPDATE deadlocks.
      await closer.query("SET LOCAL statement_timeout='3s'");
      const inserted = await closer.query("INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by) VALUES($1,'FLAG-FK',$2,$3,$4,$5,'offboarding','FK compatibility',$6,$7) RETURNING id", [id(900),personId(1),ids.companyA,ids.otherAccount,ids.license,at,ids.admin]);
      expect(inserted.rows).toHaveLength(1);
      await closer.query("UPDATE license_assignment SET ended_on='2026-10-09',end_reason='inactive' WHERE id=$1 AND company_id=$2", [assignmentId(1),ids.companyA]);
      await closer.query("COMMIT");
      expect(await work).toBe(0);
      expect(await state(1)).toBe("active");
      expect(await evidence(1)).toEqual({ transitions: [], audits: [] });
      expect((await owner.query("SELECT ended_on::text FROM license_assignment WHERE id=$1", [assignmentId(1)])).rows).toEqual([{ ended_on: "2026-10-09" }]);
      await assertForeignSentinel();
    } finally {
      await closer.query("ROLLBACK"); await work; await closer.end(); await worker.end();
    }
  });

  it("rechecks company membership after a concurrent transfer releases the person lock", async () => {
    await seedRace(false);
    const transfer = await fixture.connectAsApp();
    const worker = await namedApp("flag-person-wait");
    let work: Promise<number | Error> | undefined;
    try {
      await transfer.query("BEGIN");
      await transfer.query("SELECT id FROM person WHERE id=$1 AND company_id=$2 FOR UPDATE", [personId(1),ids.companyA]);
      work = runOn(worker).catch(error => error as Error);
      await waitBlocked("flag-person-wait", await pid(transfer));
      await transfer.query("UPDATE person SET company_id=$1 WHERE id=$2 AND company_id=$3", [ids.companyB,personId(1),ids.companyA]);
      await transfer.query("COMMIT");
      expect(await work).toBe(0);
      expect(await state(1)).toBe("active");
      expect(await evidence(1)).toEqual({ transitions: [], audits: [] });
      expect((await owner.query("SELECT company_id::text FROM person WHERE id=$1", [personId(1)])).rows).toEqual([{ company_id: ids.companyB }]);
      await assertForeignSentinel();
    } finally {
      await transfer.query("ROLLBACK"); await work; await transfer.end(); await worker.end();
    }
  });

  it("skips a discovered holder transferred away even when it returns before the assignment lock releases", async () => {
    await seedRace(false);
    const transfer = await fixture.connectAsApp();
    const assignmentLocker = await fixture.connectAsApp();
    const worker = await namedApp("flag-two-transfer-wait");
    let work: Promise<number | Error> | undefined;
    try {
      await transfer.query("BEGIN");
      await transfer.query("SELECT id FROM person WHERE id=$1 AND company_id=$2 FOR UPDATE", [personId(1),ids.companyA]);
      await assignmentLocker.query("BEGIN");
      await assignmentLocker.query("SELECT id FROM license_assignment WHERE id=$1 AND company_id=$2 FOR UPDATE", [assignmentId(1),ids.companyA]);
      const assignmentPid = await pid(assignmentLocker);
      work = runOn(worker).catch(error => error as Error);
      await waitBlocked("flag-two-transfer-wait", await pid(transfer));
      await transfer.query("UPDATE person SET company_id=$1 WHERE id=$2", [ids.companyB,personId(1)]);
      await transfer.query("COMMIT");
      // Wait on an observed outcome, not a delay. The original returns now;
      // removing the person guard instead waits for the independently held
      // stale assignment and can reach evidence after the holder returns.
      let done = false;
      work.then(() => { done = true; });
      const deadline = Date.now() + 5_000;
      let assignmentWait = false;
      while (!done && !assignmentWait && Date.now() < deadline) {
        const waits = await owner.query("SELECT pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name='flag-two-transfer-wait'");
        assignmentWait = waits.rows.some(row => row.blockers.includes(assignmentPid));
      }
      expect(done || assignmentWait).toBe(true);
      await transfer.query("BEGIN; SET LOCAL statement_timeout='3s'");
      await transfer.query("UPDATE person SET company_id=$1 WHERE id=$2", [ids.companyA,personId(1)]);
      await transfer.query("COMMIT");
      await assignmentLocker.query("COMMIT");
      expect(await work).toBe(0);
      expect(assignmentWait).toBe(false);
      expect(await state(1)).toBe("active");
      expect(await evidence(1)).toEqual({ transitions: [], audits: [] });
      expect((await owner.query("SELECT company_id::text FROM person WHERE id=$1", [personId(1)])).rows).toEqual([{ company_id: ids.companyA }]);
      await assertForeignSentinel();
    } finally {
      await assignmentLocker.query("ROLLBACK"); await transfer.query("ROLLBACK"); await work;
      await assignmentLocker.end(); await transfer.end(); await worker.end();
    }
  });

  it("recomputes newly committed activity after the request lock releases", async () => {
    await seedRace(false);
    const blocker = await fixture.connectAsApp();
    const worker = await namedApp("flag-activity-wait");
    let work: Promise<number | Error> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM license_request WHERE id=$1 AND company_id=$2 FOR UPDATE", [requestId(1),ids.companyA]);
      work = runOn(worker).catch(error => error as Error);
      await waitBlocked("flag-activity-wait", await pid(blocker));
      await activity(1, "2026-10-08");
      await blocker.query("COMMIT");
      expect(await work).toBe(0);
      expect(await state(1)).toBe("active");
      expect(await evidence(1)).toEqual({ transitions: [], audits: [] });
      await assertForeignSentinel();
    } finally {
      await blocker.query("ROLLBACK"); await work; await blocker.end(); await worker.end();
    }
  });
});
