import { evaluateInactivity, hasPositiveVendorActivity } from "@smp/domain/usage/inactivity";
import { createInactivityFlaggingRepository } from "@smp/db/inactivity-flagging";
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
    const job = createInactivityFlaggingJob({ connectionString: fixture.appUrl });
    try {
      expect(await job.drain(at)).toEqual({ processed: 1 });
      expect(await state(1)).toBe("active");
      expect(await state(2)).toBe("flagged_inactive");
      const before = await evidence(1);
      expect(before.audits.map(row => row.action).sort()).toEqual(["request.active", "request.flagged_inactive"]);
      expect(await job.drain(at)).toEqual({ processed: 0 });
      expect(await evidence(1)).toEqual(before);
      expect(await evidence(2)).toEqual({ transitions: [], audits: [] });
      await expect(job.drain(new Date("invalid"))).rejects.toThrow("Invalid inactivity flagging timestamp");
    } finally { await job.close(); }
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
