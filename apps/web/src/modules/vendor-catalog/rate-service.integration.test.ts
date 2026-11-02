import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import * as schema from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createRateService } from "./rate-service";
import { createRateServerActions } from "./actions/manage-rates-server-actions-factory";

const id = (n: number) => `32000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-11-01T00:00:00Z");
const finance: LedgerAuthorization = {
  userId: id(1), userAccountId: id(1), idpSubject: "rates-finance",
  globalRole: "central_finance", roles: ["central_finance"],
  companyIds: [id(5)], companyGrants: [], employeeCompanyId: null,
};
const command = { vendorAccountId: id(3), licenseTypeId: id(4), monthlyRateUsd: "62.00", effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31", provisional: true };
let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let service: ReturnType<typeof createRateService>;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  await owner.query(`INSERT INTO user_account (id,email,global_role,status,created_at) VALUES ($1,'rates@test.invalid','central_finance','active',$2)`, [id(1), now]);
  await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES ($1,'Manual','manual','none',false,false,false,false,'email','active',$2,$3)`, [id(2), now, id(1)]);
  await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES ($1,$2,'Pilot org','orchestration',0,'active',$3,$4)`, [id(3), id(2), now, id(1)]);
  await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by) VALUES ($1,$2,'Seat','seat','active',$3,$4)`, [id(4), id(2), now, id(1)]);
  await owner.query(`INSERT INTO company (id,name,code,type,status,created_at,created_by) VALUES ($1,'A','RATE-A','internal','active',$2,$3),($4,'B','RATE-B','internal','active',$2,$3)`, [id(5), now, id(1), id(6)]);
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  database = drizzle(pool, { schema });
  service = createRateService(database, { now: () => now });
});
afterAll(async () => { await pool?.end(); await owner?.end(); await fixture?.stop(); });

test("adds exact provisional rates, rejects inclusive overlaps and preserves adjacent periods", async () => {
  const row = await service.saveRateCard(finance, command);
  expect(row.monthlyRateUsd).toBe("62.00");
  expect(row.provisional).toBe(true);
  for (const dates of [
    ["2026-01-31", "2026-02-02"], ["2025-12-01", "2026-01-01"],
    ["2026-01-15", "2026-01-16"], ["2025-01-01", null],
  ]) await expect(service.saveRateCard(finance, { ...command, effectiveFrom: dates[0], effectiveTo: dates[1] })).rejects.toThrow();
  const next = await service.saveRateCard(finance, { ...command, effectiveFrom: "2026-02-01", effectiveTo: "2026-02-28", provisional: false });
  expect(next.provisional).toBe(false);
  const audit = await owner.query(`SELECT after->>'monthlyRateUsd' AS amount, occurred_at FROM audit_log WHERE entity_id=$1 AND action='rate.saved'`, [row.id]);
  expect(audit.rows).toEqual([{ amount: "62.00", occurred_at: now }]);
  expect((await owner.query(`SELECT count(*)::int AS n FROM rate_card`)).rows[0].n).toBe(2);
});

test("rejects invalid money, dates, unknown fields and mismatched catalog ownership before writes", async () => {
  for (const changes of [
    { monthlyRateUsd: "-1.00" }, { monthlyRateUsd: "1.001" }, { monthlyRateUsd: "100000000.00" },
    { effectiveFrom: "2026-02-30" }, { effectiveTo: "2025-12-31" },
    { companyId: id(6) }, { licenseTypeId: id(99) },
  ]) await expect(service.saveRateCard(finance, { ...command, ...changes })).rejects.toThrow();
});

test("denies anonymous and company-scoped roles for both reads and writes", async () => {
  for (const authorization of [null, { ...finance, globalRole: null, roles: ["company_finance"], companyIds: [id(6)] } as LedgerAuthorization]) {
    await expect(service.saveRateCard(authorization, command)).rejects.toThrow("RATE_ACCESS_FORBIDDEN");
    await expect(service.workspace(authorization)).rejects.toThrow("RATE_ACCESS_FORBIDDEN");
  }
});

test("allows unconsumed edits but locks every field and deletion after final consumption", async () => {
  const row = await service.saveRateCard(finance, { ...command, effectiveFrom: "2026-03-01", effectiveTo: "2026-03-31" });
  const edited = await service.saveRateCard(finance, { ...command, id: row.id, effectiveFrom: "2026-03-01", effectiveTo: "2026-03-31", monthlyRateUsd: "58.50" });
  expect(edited.monthlyRateUsd).toBe("58.50");
  await owner.query(`INSERT INTO statement (id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES ($1,$2,'2026-03','draft',1,58.50,$3,$3)`, [id(10), id(5), now]);
  await owner.query(`INSERT INTO statement_line (statement_id,kind,vendor_account_id,license_type_id,rate_usd,amount_usd,period_from,period_to) VALUES ($1,'license',$2,$3,58.50,58.50,'2026-03-01','2026-03-31')`, [id(10), id(3), id(4)]);
  expect((await service.workspace(finance)).rates.find(r => r.id === row.id)?.locked).toBe(false);
  await owner.query(`UPDATE statement SET status='final' WHERE id=$1`, [id(10)]);
  await expect(service.saveRateCard(finance, { ...command, id: row.id, monthlyRateUsd: "60.00" })).rejects.toThrow();
  await expect(owner.query(`UPDATE rate_card SET provisional=false WHERE id=$1`, [row.id])).rejects.toMatchObject({ code: "23514" });
  await expect(owner.query(`DELETE FROM rate_card WHERE id=$1`, [row.id])).rejects.toMatchObject({ code: "23514" });
  expect((await service.workspace(finance)).rates.find(r => r.id === row.id)?.locked).toBe(true);
  expect((await owner.query(`SELECT monthly_rate_usd FROM rate_card WHERE id=$1`, [row.id])).rows[0].monthly_rate_usd).toBe("58.50");
});

test("lists purchased capacity beside persisted rates and accepts the administrator", async () => {
  await owner.query(`INSERT INTO vendor_account_capacity (vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by) VALUES ($1,$2,140,'2026-01-01',$3,$4)`, [id(3), id(4), now, id(1)]);
  const workspace = await service.workspace({ ...finance, globalRole: "group_admin" });
  expect(workspace.capacity[0].purchasedQty).toBe(140);
  expect(workspace.capacity[0].accountName).toBe("Pilot org");
  expect(workspace.rates.length).toBe(3);
  expect(workspace.accounts[0].id).toBe(id(3));
  expect(workspace.licenses[0].id).toBe(id(4));
});

test("server action persists manual input, reports failures without revalidation, and revalidates only committed saves", async () => {
  const paths: string[] = [];
  const actions = createRateServerActions({ database, now: () => now,
    loadAuthorization: async () => finance, revalidate: path => { paths.push(path); } });
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...command, effectiveFrom: "2027-01-01", effectiveTo: "2027-12-31", provisional: "on" })) form.set(key, value);
  const result = await actions.saveRateCard({ status: "idle" }, form);
  expect(result.status).toBe("success");
  expect(paths).toEqual(["/tarifas"]);
  const saved = (await owner.query(`SELECT effective_to::text,provisional,created_at FROM rate_card WHERE id=$1`, [result.id])).rows[0];
  expect(saved.effective_to).toBe("2027-12-31");
  expect(saved.provisional).toBe(true);
  expect(saved.created_at.toISOString()).toBe(now.toISOString());
  form.set("monthlyRateUsd", "65.25"); form.set("provisional", ""); form.set("id", result.id!);
  form.set("effectiveTo", "");
  expect((await actions.saveRateCard({ status: "idle" }, form)).status).toBe("success");
  expect((await owner.query(`SELECT monthly_rate_usd,provisional FROM rate_card WHERE id=$1`, [result.id])).rows[0]).toEqual({ monthly_rate_usd: "65.25", provisional: false });
  form.set("monthlyRateUsd", "bad");
  expect(await actions.saveRateCard({ status: "idle" }, form)).toEqual({ status: "error" });
  expect(paths).toHaveLength(2);
  for (const loadAuthorization of [async () => null, async () => { throw new Error("Session unavailable"); }]) {
    const denied = createRateServerActions({ database, loadAuthorization, revalidate: path => { paths.push(path); } });
    expect(await denied.saveRateCard({ status: "idle" }, form)).toEqual({ status: "error" });
  }
  expect(paths).toHaveLength(2);
});

test("the production default clock persists the creation and audit timestamps", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  try {
    const row = await createRateService(database).saveRateCard(finance, { ...command, effectiveFrom: "2024-01-01", effectiveTo: "2024-01-31" });
    expect(row.createdAt).toEqual(now);
    const audit = await owner.query(`SELECT occurred_at FROM audit_log WHERE entity_id=$1 AND action='rate.saved'`, [row.id]);
    expect(audit.rows).toEqual([{ occurred_at: now }]);
  } finally { vi.useRealTimers(); }
});

test("saving a rate locks its account without blocking an independent license catalog edit", async () => {
  const locker = await fixture.connectAsOwner();
  const writer = await fixture.connectAsApp();
  try {
    await locker.query("BEGIN");
    await locker.query(`SELECT id FROM license_type WHERE id=$1 FOR NO KEY UPDATE`, [id(4)]);
    const lockerPid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await writer.query("SET statement_timeout='10s'");
    let settled = false;
    const save = createRateService(drizzle(writer, { schema }), { now: () => now }).saveRateCard(finance, {
      ...command, effectiveFrom: "2023-01-01", effectiveTo: "2023-01-31",
    }).then(value => ({ value, error: null }), error => ({ value: null, error })).finally(() => { settled = true; });
    let blocked = false;
    try {
      while (!settled && !blocked) blocked = (await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`, [lockerPid, writerPid])).rows[0].blocked;
    } finally { await locker.query("ROLLBACK"); }
    expect(blocked).toBe(false);
    expect((await save).value?.monthlyRateUsd).toBe("62.00");
  } finally { await locker.query("ROLLBACK"); await locker.end(); await writer.end(); }
});

test("database exclusion protects concurrent open-ended inserts, independent of application checks", async () => {
  const insert = (from: string) => pool.query(`INSERT INTO rate_card (vendor_account_id,license_type_id,monthly_rate_usd,effective_from,effective_to,created_at,created_by) VALUES ($1,$2,0,$5,NULL,$3,$4) RETURNING id`, [id(3), id(4), now, id(1), from]);
  // The previous open-ended manual row must first be ended while still unconsumed.
  await owner.query(`UPDATE rate_card SET effective_to='2027-12-31' WHERE effective_from='2027-01-01'`);
  const outcomes = await Promise.allSettled([insert("2028-01-01"), insert("2028-02-01")]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "23P01" } });
});

test("locked corrections use a new non-overlapping row and reconciled legacy lines also lock", async () => {
  const correction = await service.saveRateCard(finance, { ...command, effectiveFrom: "2026-04-01", effectiveTo: "2026-04-30", monthlyRateUsd: "60.00" });
  expect(correction.effectiveFrom).toBe("2026-04-01");
  const old = (await owner.query(`SELECT monthly_rate_usd FROM rate_card WHERE effective_from='2026-03-01'`)).rows[0];
  expect(old.monthly_rate_usd).toBe("58.50");
  await owner.query(`INSERT INTO statement (id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES ($1,$2,'2027-01','reconciled',1,65.25,$3,$3)`, [id(11), id(6), now]);
  await owner.query(`INSERT INTO statement_line (statement_id,kind,vendor_account_id,license_type_id,rate_usd,amount_usd) VALUES ($1,'license',$2,$3,65.25,65.25)`, [id(11), id(3), id(4)]);
  const legacy = (await service.workspace(finance)).rates.find(row => row.effectiveFrom === "2027-01-01")!;
  expect(legacy.locked).toBe(true);
  await expect(service.saveRateCard(finance, { ...command, id: legacy.id })).rejects.toThrow();
});

test("rejects inactive and foreign vendor catalogs and missing edit identities without creating rows", async () => {
  const input = { ...command, effectiveFrom: "2029-01-01", effectiveTo: "2029-01-31" };
  for (const table of ["vendor_account", "license_type"]) {
    await owner.query(`UPDATE ${table} SET status='inactive'`);
    try { await expect(service.saveRateCard(finance, input)).rejects.toThrow("RATE_LICENSE_VENDOR_MISMATCH"); }
    finally { await owner.query(`UPDATE ${table} SET status='active'`); }
  }
  await expect(service.saveRateCard(finance, { ...input, id: id(99) })).rejects.toThrow("RATE_NOT_FOUND");
  await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES ($1,'Other vendor','manual','none',false,false,false,false,'email','active',$2,$3)`, [id(20), now, id(1)]);
  await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by) VALUES ($1,$2,'Other seat','seat','active',$3,$4)`, [id(21), id(20), now, id(1)]);
  await expect(service.saveRateCard(finance, { ...input, licenseTypeId: id(21) })).rejects.toThrow("RATE_LICENSE_VENDOR_MISMATCH");
});

test("audit failure rolls back a rate insert rather than leaving unaudited financial state", async () => {
  await owner.query(`CREATE FUNCTION reject_rate_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='RateCard' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_rate_audit_test BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_rate_audit_test()`);
  try {
    await expect(service.saveRateCard(finance, { ...command, effectiveFrom: "2025-01-01", effectiveTo: "2025-01-31" })).rejects.toThrow("test audit unavailable");
    expect((await owner.query(`SELECT id FROM rate_card WHERE effective_from='2025-01-01'`)).rows).toEqual([]);
  } finally { await owner.query(`DROP TRIGGER reject_rate_audit_test ON audit_log; DROP FUNCTION reject_rate_audit_test()`); }
});

const raceMutations = ["app-edit", "owner-update", "owner-delete"] as const;
async function raceRows(sequence: number, withLine = true) {
  const accountId = id(100 + sequence * 3);
  const rateId = id(101 + sequence * 3);
  const statementId = id(102 + sequence * 3);
  const companyId = id(200 + sequence);
  await owner.query(`INSERT INTO company (id,name,code,type,status,created_at,created_by) VALUES ($1,$2,$2,'internal','active',$3,$4)`, [companyId, `RACE-${sequence}`, now, id(1)]);
  await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
    VALUES ($1,$2,$3,'orchestration',0,'active',$4,$5)`, [accountId, id(2), `Race ${sequence}`, now, id(1)]);
  await owner.query(`INSERT INTO rate_card (id,vendor_account_id,license_type_id,monthly_rate_usd,effective_from,effective_to,created_at,created_by)
    VALUES ($1,$2,$3,62,'2030-01-01','2030-01-31',$4,$5)`, [rateId, accountId, id(4), now, id(1)]);
  // Consumption outside the operator's company must still lock the global rate.
  await owner.query(`INSERT INTO statement (id,company_id,period,status,opening_seats,total_usd,generated_at,created_at)
    VALUES ($1,$2,'2030-01','draft',1,62,$3,$3)`, [statementId, companyId, now]);
  if (withLine) await owner.query(`INSERT INTO statement_line (statement_id,kind,vendor_account_id,license_type_id,rate_usd,amount_usd,period_from,period_to)
    VALUES ($1,'license',$2,$3,62,62,'2030-01-01','2030-01-31')`, [statementId, accountId, id(4)]);
  return { rateId, statementId, companyId };
}
function mutateRate(client: pg.Client, mutation: typeof raceMutations[number], rateId: string) {
  if (mutation === "app-edit") return client.query(`SELECT * FROM public.edit_unconsumed_rate_card($1,$2,65,'2030-01-01','2030-01-31',true)`, [rateId, id(1)]);
  if (mutation === "owner-delete") return client.query(`DELETE FROM rate_card WHERE id=$1`, [rateId]);
  return client.query(`UPDATE rate_card SET monthly_rate_usd=65 WHERE id=$1`, [rateId]);
}
test.each(raceMutations)("rate-first %s serializes finalization behind the mutation", async mutation => {
  const { rateId, statementId, companyId } = await raceRows(raceMutations.indexOf(mutation));
  const writer = await (mutation === "app-edit" ? fixture.connectAsApp() : fixture.connectAsOwner());
  const finalizer = await fixture.connectAsApp();
  try {
    await writer.query("BEGIN"); await finalizer.query("BEGIN");
    await writer.query("SET LOCAL statement_timeout = '10s'");
    await finalizer.query("SET LOCAL statement_timeout = '10s'");
    await mutateRate(writer, mutation, rateId);
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const finalizerPid = (await finalizer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let settled = false;
    const finalize = finalizer.query(`UPDATE statement SET status='final' WHERE id=$1`, [statementId]).finally(() => { settled = true; });
    try {
      let blocked = false;
      while (!settled && !blocked) blocked = (await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`, [writerPid, finalizerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
    } finally { await writer.query("ROLLBACK"); await finalize; }
    await finalizer.query("COMMIT");
    expect((await owner.query(`SELECT monthly_rate_usd FROM rate_card WHERE id=$1`, [rateId])).rows).toEqual([{ monthly_rate_usd: "62.00" }]);
    expect((await owner.query(`SELECT status,company_id FROM statement WHERE id=$1`, [statementId])).rows).toEqual([{ status: "final", company_id: companyId }]);
  } finally { await writer.query("ROLLBACK"); await finalizer.query("ROLLBACK"); await writer.end(); await finalizer.end(); }
});

test("rate-first mutation serializes a newly inserted consuming line before finalization", async () => {
  const { rateId, statementId } = await raceRows(6, false);
  const writer = await fixture.connectAsApp();
  const consumer = await fixture.connectAsApp();
  try {
    await writer.query("BEGIN"); await consumer.query("BEGIN");
    await writer.query("SET LOCAL statement_timeout = '10s'");
    await consumer.query("SET LOCAL statement_timeout = '10s'");
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const consumerPid = (await consumer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await mutateRate(writer, "app-edit", rateId);
    let settled = false;
    const consume = consumer.query(`INSERT INTO statement_line (statement_id,kind,vendor_account_id,license_type_id,rate_usd,amount_usd,period_from,period_to)
      SELECT $1,'license',vendor_account_id,license_type_id,62,62,'2030-01-01','2030-01-31' FROM rate_card WHERE id=$2`, [statementId, rateId]).finally(() => { settled = true; });
    try {
      let blocked = false;
      while (!settled && !blocked) blocked = (await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`, [writerPid, consumerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
    } finally { await writer.query("ROLLBACK"); await consume; }
    await consumer.query(`UPDATE statement SET status='final' WHERE id=$1`, [statementId]);
    await consumer.query("COMMIT");
    expect((await owner.query(`SELECT monthly_rate_usd FROM rate_card WHERE id=$1`, [rateId])).rows).toEqual([{ monthly_rate_usd: "62.00" }]);
    await expect(mutateRate(writer, "app-edit", rateId)).rejects.toMatchObject({ code: "23514" });
  } finally { await writer.query("ROLLBACK"); await consumer.query("ROLLBACK"); await writer.end(); await consumer.end(); }
});

test("new-consumption-first mutation sees the newly committed final line after waiting", async () => {
  const { rateId, statementId } = await raceRows(7, false);
  const writer = await fixture.connectAsApp();
  const consumer = await fixture.connectAsApp();
  try {
    await writer.query("BEGIN"); await consumer.query("BEGIN");
    await writer.query("SET LOCAL statement_timeout = '10s'");
    await consumer.query("SET LOCAL statement_timeout = '10s'");
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const consumerPid = (await consumer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await consumer.query(`INSERT INTO statement_line (statement_id,kind,vendor_account_id,license_type_id,rate_usd,amount_usd,period_from,period_to)
      SELECT $1,'license',vendor_account_id,license_type_id,62,62,'2030-01-01','2030-01-31' FROM rate_card WHERE id=$2`, [statementId, rateId]);
    await consumer.query(`UPDATE statement SET status='final' WHERE id=$1`, [statementId]);
    let settled = false;
    const write = mutateRate(writer, "app-edit", rateId).then(
      value => ({ value, error: null }), error => ({ value: null, error }),
    ).finally(() => { settled = true; });
    try {
      let blocked = false;
      while (!settled && !blocked) blocked = (await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`, [consumerPid, writerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
    } finally { await consumer.query("COMMIT"); }
    expect((await write).error).toMatchObject({ code: "23514", message: "RATE_LOCKED_NEW_PERIOD_REQUIRED" });
    await writer.query("ROLLBACK");
    expect((await owner.query(`SELECT monthly_rate_usd FROM rate_card WHERE id=$1`, [rateId])).rows).toEqual([{ monthly_rate_usd: "62.00" }]);
  } finally { await writer.query("ROLLBACK"); await consumer.query("ROLLBACK"); await writer.end(); await consumer.end(); }
});

test.each(raceMutations)("finalization-first %s sees committed final state after waiting", async mutation => {
  const { rateId, statementId, companyId } = await raceRows(3 + raceMutations.indexOf(mutation));
  const writer = await (mutation === "app-edit" ? fixture.connectAsApp() : fixture.connectAsOwner());
  const finalizer = await fixture.connectAsApp();
  try {
    await writer.query("BEGIN"); await finalizer.query("BEGIN");
    await writer.query("SET LOCAL statement_timeout = '10s'");
    await finalizer.query("SET LOCAL statement_timeout = '10s'");
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const finalizerPid = (await finalizer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await finalizer.query(`UPDATE statement SET status='final' WHERE id=$1`, [statementId]);
    let settled = false;
    const write = mutateRate(writer, mutation, rateId).then(
      value => ({ value, error: null }), error => ({ value: null, error }),
    ).finally(() => { settled = true; });
    try {
      let blocked = false;
      while (!settled && !blocked) blocked = (await owner.query(`SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked`, [finalizerPid, writerPid])).rows[0].blocked;
      expect(blocked).toBe(true);
    } finally { await finalizer.query("COMMIT"); }
    expect((await write).error).toMatchObject({ code: "23514", message: "RATE_LOCKED_NEW_PERIOD_REQUIRED" });
    await writer.query("ROLLBACK");
    expect((await owner.query(`SELECT monthly_rate_usd FROM rate_card WHERE id=$1`, [rateId])).rows).toEqual([{ monthly_rate_usd: "62.00" }]);
    expect((await owner.query(`SELECT status,company_id FROM statement WHERE id=$1`, [statementId])).rows).toEqual([{ status: "final", company_id: companyId }]);
  } finally { await writer.query("ROLLBACK"); await finalizer.query("ROLLBACK"); await writer.end(); await finalizer.end(); }
});
