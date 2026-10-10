import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { activityRecord, licenseAssignment } from "@smp/db/schema";
import { createUsageRepository, UsageReadError } from "./repository";
import { createUsageFixture, usageIds as i, usageId, USAGE_EVALUATION_DATE as today } from "./testing/fixture-transaction";

let f: Awaited<ReturnType<typeof createUsageFixture>>;
beforeAll(async () => { f = await createUsageFixture(); });
afterAll(async () => { await f?.stop(); });
const read = (window: 30 | 60 | 90 = 30, companyId: string | null = i.companyA, cursor?: string) => createUsageRepository(f.database).read(f.admin, { window, companyId: companyId ?? undefined, cursor }, today);

test("only open company A licenses and scoped anchors are returned with account-specific evidence", async () => {
  const model = await read();
  expect(model.rows.map(r => r.assignmentId).sort()).toEqual(Array.from({ length: 9 }, (_, n) => usageId(30 + n)));
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
