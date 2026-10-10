import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@smp/db/schema";
import { activityRecord, company, licenseAssignment } from "@smp/db/schema";
import { createUsageRepository, UsageReadError } from "./repository";
import { createUsageFixture, usageIds as i, usageId, USAGE_EVALUATION_DATE as today } from "./testing/fixture-transaction";

let f: Awaited<ReturnType<typeof createUsageFixture>>;
beforeAll(async () => { f = await createUsageFixture(); });
afterAll(async () => { await f?.stop(); });
const read = (window: 30 | 60 | 90 = 30, companyId: string | null = i.companyA, cursor?: string) => createUsageRepository(f.database).read(f.admin, { window, companyId: companyId ?? undefined, cursor }, today);

test("only open company A licenses and scoped anchors are returned with account-specific evidence", async () => {
  const model = await read();
  expect(model.rows.map(r => r.assignmentId).sort()).toEqual(Array.from({ length: 9 }, (_, n) => usageId(30 + n)));
  expect(model.rows.map(r => r.assignmentId)).toEqual([30,31,32,33,37,38,34,35,36].map(usageId));
  expect(model.rows.every(r => r.companyId === i.companyA)).toBe(true);
  expect(JSON.stringify(model)).not.toContain("Foreign Bea");
  expect(model.rows.find(r => r.assignmentId === usageId(30))).toMatchObject({ lastActivityDate: "2026-09-06", dataThrough: "2026-10-07", daysInactive: 31, classification: "inactive", anchorState: "flagged_inactive" });
  expect(model.rows.find(r => r.assignmentId === usageId(32))).toMatchObject({ lastActivityDate: "2026-09-01", dataThrough: "2026-10-01", daysInactive: 30, classification: "active", anchorState: null });
  expect(model.rows.find(r => r.assignmentId === usageId(33))).toMatchObject({ daysInactive: 0, classification: "active" });
  expect(model.freshness).toEqual([
    { accountId: i.accountX, accountName: "Account X", dataThrough: "2026-10-07", fallback: false },
    { accountId: i.accountY, accountName: "Account Y", dataThrough: "2026-10-01", fallback: false },
  ]);
});
test("cards count licenses over all results, no positive history remains no data and windows preserve state", async () => {
  const thirty = await read(); const sixty = await read(60); const ninety = await read(90);
  expect(thirty.metrics).toEqual({ total: 9, active: 4, inactive: 2, noData: 3, activePercent: 100 * 4 / 9 });
  expect(sixty.metrics).toEqual({ total: 9, active: 6, inactive: 0, noData: 3, activePercent: 100 * 6 / 9 });
  expect(ninety.metrics).toEqual(sixty.metrics);
  for (const model of [thirty, sixty, ninety]) {
    expect(model.metrics.active + model.metrics.inactive + model.metrics.noData).toBe(model.metrics.total);
    for (const n of [34, 35, 36]) expect(model.rows.find(r => r.assignmentId === usageId(n))).toMatchObject({ lastActivityDate: null, daysInactive: null, classification: "no_data" });
    for (const n of [37, 38]) expect(model.rows.find(r => r.assignmentId === usageId(n))).toMatchObject({ daysInactive: 0, classification: "active" });
  }
  expect(sixty.rows.find(r => r.assignmentId === usageId(30))).toMatchObject({ classification: "active", anchorState: "flagged_inactive" });
  expect((await read(30, null)).metrics.total).toBe(10);
  const empty = await read(30, i.emptyCompany);
  expect(empty.rows).toEqual([]); expect(empty.metrics).toEqual({ total: 0, active: 0, inactive: 0, noData: 0, activePercent: 0 });
});
test("authorization and forged company filters refuse before any business result", async () => {
  const repo = createUsageRepository(f.database);
  for (const authorization of [null, f.viewer, { ...f.admin, globalRole: "central_finance" as const }]) {
    await expect(repo.read(authorization, { window: 30 }, today)).rejects.toMatchObject({ code: "access_denied" });
  }
  await expect(read(30, usageId(999))).rejects.toMatchObject({ code: "access_denied" });
  await expect(repo.read(f.admin, { window: 31 as 30 }, today)).rejects.toMatchObject({ code: "invalid_filter" });
  expect(new UsageReadError("access_denied")).toBeInstanceOf(Error);
});
test("a foreign anchor is unavailable and other-company observations may advance only aggregate freshness", async () => {
  await f.ownerDb.update(licenseAssignment).set({ sourceRequestId: i.foreignRequest }).where(eq(licenseAssignment.id, usageId(36)));
  await f.ownerDb.insert(activityRecord).values({ personId: i.foreign, vendorAccountId: i.accountX, activityDate: "2026-10-08", counters: { chat_metrics: { message_count: 999 } }, syncedAt: new Date("2026-10-10T00:00:00Z"), source: "manual" });
  try {
    const model = await read();
    expect(model.rows.find(r => r.assignmentId === usageId(36))?.anchorState).toBeNull();
    expect(model.rows.find(r => r.assignmentId === usageId(30))).toMatchObject({ lastActivityDate: "2026-09-06", dataThrough: "2026-10-08", daysInactive: 32 });
    expect(JSON.stringify(model)).not.toContain("Foreign Bea");
    expect(JSON.stringify(model)).not.toContain("999");
  } finally {
    await f.owner.query("DELETE FROM activity_record WHERE person_id=$1 AND activity_date='2026-10-08'", [i.foreign]);
    await f.ownerDb.update(licenseAssignment).set({ sourceRequestId: null }).where(eq(licenseAssignment.id, usageId(36)));
  }
});
test("real app-role reads require repeatable-read and read-only transaction settings", async () => {
  const original = (await f.owner.query("SELECT relrowsecurity FROM pg_class WHERE oid='company'::regclass")).rows[0].relrowsecurity;
  await f.owner.query(`ALTER TABLE company ENABLE ROW LEVEL SECURITY;
    CREATE POLICY usage_fixture_allow ON company FOR SELECT TO ledger_app USING (true);
    CREATE POLICY usage_snapshot_probe ON company AS RESTRICTIVE FOR SELECT TO ledger_app
      USING (current_setting('transaction_isolation')='repeatable read' AND current_setting('transaction_read_only')='on');`);
  try {
    expect((await f.database.transaction(tx => tx.select({ id: company.id }).from(company), { isolationLevel: "read committed", accessMode: "read only" }))).toEqual([]);
    expect((await f.database.transaction(tx => tx.select({ id: company.id }).from(company), { isolationLevel: "repeatable read", accessMode: "read write" }))).toEqual([]);
    const result = await read();
    expect(result.rows).toHaveLength(9);
    expect(result.companies.map(c => c.id)).toContain(i.companyA);
    expect(result.rows.every(row => row.companyId === i.companyA)).toBe(true);
  } finally {
    await f.owner.query("DROP POLICY usage_snapshot_probe ON company; DROP POLICY usage_fixture_allow ON company");
    if (!original) await f.owner.query("ALTER TABLE company DISABLE ROW LEVEL SECURITY");
  }
});

test("last known positive date is the maximum even with later unknown observations", async () => {
  await f.ownerDb.insert(activityRecord).values([
    ...Array.from({ length: 20 }, (_, index) => ({ personId: i.old, vendorAccountId: i.accountX, activityDate: `2026-08-${String(index + 1).padStart(2, "0")}`, counters: { chat_metrics: { message_count: index + 1 } }, syncedAt: new Date("2026-10-10T00:00:00Z"), source: "manual" as const })),
    { personId: i.old, vendorAccountId: i.accountX, activityDate: "2026-09-07", counters: { chat_metrics: { message_count: 2 } }, syncedAt: new Date("2026-10-10T00:00:00Z"), source: "manual" },
    { personId: i.old, vendorAccountId: i.accountX, activityDate: "2026-09-05", counters: { chat_metrics: { message_count: 1 } }, syncedAt: new Date("2026-10-10T00:00:00Z"), source: "manual" },
  ]);
  const client = await f.appPool.connect();
  try {
    // Exercise a real hash DISTINCT plan, whose observation order is not chronological.
    await client.query("SET enable_sort=off; SET enable_hashagg=on; SET enable_indexscan=off; SET enable_indexonlyscan=off; SET enable_bitmapscan=off");
    const model = await createUsageRepository(drizzle(client, { schema })).read(f.admin, { window: 30, companyId: i.companyA }, today);
    expect(model.rows.filter(r => r.personId === i.old && r.vendorAccountId === i.accountX).map(r => [r.lastActivityDate, r.daysInactive])).toEqual([["2026-09-07", 30], ["2026-09-07", 30]]);
  } finally {
    await client.query("RESET enable_sort; RESET enable_hashagg; RESET enable_indexscan; RESET enable_indexonlyscan; RESET enable_bitmapscan"); client.release();
    await f.owner.query("DELETE FROM activity_record WHERE person_id=$1 AND (activity_date BETWEEN '2026-08-01' AND '2026-08-20' OR activity_date IN ('2026-09-05','2026-09-07'))", [i.old]);
  }
});

test("equal-age licenses sort ascending independently of reverse physical insertion", async () => {
  const reverse = [103, 102, 101];
  for (const n of reverse) {
    await f.owner.query("INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,$2,$3,$4,'active','2026-01-01',$5)", [usageId(n), `tie${n}@example.com`, `Tie ${n}`, i.emptyCompany, i.admin]);
    await f.owner.query("INSERT INTO license_assignment(id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_kind,created_at,created_by) VALUES($1,$2,$3,$4,$5,'2026-08-01','import','2026-01-01',$6)", [usageId(n + 100), usageId(n), i.emptyCompany, i.accountX, i.typeA, i.admin]);
  }
  const client = await f.appPool.connect();
  try {
    await client.query("SET enable_hashjoin=off; SET enable_mergejoin=off; SET enable_indexscan=off; SET enable_indexonlyscan=off; SET enable_bitmapscan=off");
    const model = await createUsageRepository(drizzle(client, { schema })).read(f.admin, { window: 30, companyId: i.emptyCompany }, today);
    expect(model.rows.map(row => [row.assignmentId, row.daysInactive])).toEqual([101, 102, 103].map(n => [usageId(n + 100), null]));
    expect(model.metrics).toMatchObject({ total: 3, active: 0, inactive: 0, noData: 3 });
  } finally {
    await client.query("RESET enable_hashjoin; RESET enable_mergejoin; RESET enable_indexscan; RESET enable_indexonlyscan; RESET enable_bitmapscan"); client.release();
    await f.owner.query("DELETE FROM license_assignment WHERE company_id=$1", [i.emptyCompany]);
    await f.owner.query("DELETE FROM person WHERE company_id=$1", [i.emptyCompany]);
  }
});

test("cursor payload rejects missing binding fields, unknown fields and noncanonical encoding", async () => {
  const valid = { companyId: i.companyA, window: 30, sort: "age_desc_id_asc", daysInactive: 0, assignmentId: usageId(33) };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  for (const field of Object.keys(valid)) {
    const missing = { ...valid } as Record<string, unknown>; delete missing[field];
    await expect(read(30, i.companyA, encode(missing))).rejects.toMatchObject({ code: "invalid_cursor" });
  }
  for (const payload of [{ ...valid, sort: "wrong" }, { ...valid, extra: true }, { ...valid, assignmentId: "wrong" }, { ...valid, daysInactive: 0.5 }]) await expect(read(30, i.companyA, encode(payload))).rejects.toMatchObject({ code: "invalid_cursor" });
  const canonical = encode(valid);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  // The final character's unused padding bits change no decoded payload bytes.
  const paddedPayload = JSON.stringify(valid) + " ";
  const padded = Buffer.from(paddedPayload).toString("base64url");
  const noncanonical = padded.slice(0, -1) + alphabet[alphabet.indexOf(padded.at(-1)!) ^ 1];
  expect(Buffer.from(noncanonical, "base64url").toString()).toBe(paddedPayload);
  await expect(read(30, i.companyA, noncanonical)).rejects.toMatchObject({ code: "invalid_cursor" });
  expect((await read(30, i.companyA, canonical)).rows.map(r => r.assignmentId)).toEqual([usageId(37), usageId(38), usageId(34), usageId(35), usageId(36)]);
});

test("an unsynced account uses estimated fallback without inventing activity", async () => {
  const records = await f.ownerDb.select().from(activityRecord).where(eq(activityRecord.vendorAccountId, i.accountY));
  await f.ownerDb.delete(activityRecord).where(eq(activityRecord.vendorAccountId, i.accountY));
  try {
    const model = await read();
    expect(model.rows.find(r => r.assignmentId === usageId(32))).toMatchObject({ dataThrough: "2026-10-07", daysInactive: null, classification: "no_data" });
    expect(model.freshness.find(a => a.accountId === i.accountY)?.fallback).toBe(true);
  } finally { await f.ownerDb.insert(activityRecord).values(records); }
});
test("stable cursor continues ties, binds filters, and leaves full-set cards intact", async () => {
  await f.owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by)
    SELECT ('00000000-0000-4000-8000-' || lpad((721000+n)::text,12,'0'))::uuid, 'page'||n||'@example.com', 'Paged '||n, $1, 'active', '2026-01-01', $2 FROM generate_series(1,60) n`, [i.companyA, i.admin]);
  await f.owner.query(`INSERT INTO license_assignment(id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_kind,created_at,created_by)
    SELECT ('00000000-0000-4000-8000-' || lpad((722000+n)::text,12,'0'))::uuid, ('00000000-0000-4000-8000-' || lpad((721000+n)::text,12,'0'))::uuid, $1,$2,$3,'2026-08-01','import','2026-01-01',$4 FROM generate_series(1,60) n`, [i.companyA, i.accountX, i.typeA, i.admin]);
  try {
    const first = await read(); expect(first.rows).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    const second = await read(30, i.companyA, first.nextCursor!);
    expect(second.rows).toHaveLength(19); expect(second.nextCursor).toBeNull();
    expect(second.metrics).toEqual(first.metrics); expect(first.metrics.total).toBe(69);
    expect(new Set([...first.rows, ...second.rows].map(r => r.assignmentId)).size).toBe(69);
    const allIds = [...first.rows, ...second.rows].map(r => r.assignmentId);
    expect(allIds.slice(0, 2)).toEqual([usageId(30), usageId(31)]);
    await expect(read(60, i.companyA, first.nextCursor!)).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(read(30, null, first.nextCursor!)).rejects.toMatchObject({ code: "invalid_cursor" });
    for (const cursor of ["garbage", Buffer.from(JSON.stringify({ companyId: i.companyA, window: 30, sort: "age_desc_id_asc", daysInactive: -1, assignmentId: usageId(30) })).toString("base64url")]) await expect(read(30, i.companyA, cursor)).rejects.toMatchObject({ code: "invalid_cursor" });
  } finally {
    await f.owner.query("DELETE FROM license_assignment WHERE id::text LIKE '00000000-0000-4000-8000-000000722%'");
    await f.owner.query("DELETE FROM person WHERE id::text LIKE '00000000-0000-4000-8000-000000721%'");
  }
});
