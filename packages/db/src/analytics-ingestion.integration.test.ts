import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { normalizeActivityCounters } from "@smp/connectors";
import { ingestCostBatch, resolveCostScopes, type CostBatch, ingestActivityBatch, resolveActivityScopes, type ActivityBatch, type ActivityBatchResult } from "./analytics-ingestion";
import * as schema from "./schema";
import { createPostgresFixture, type PostgresFixture } from "./testing/postgres-container";
import { SYSTEM_USER_ID } from "./system-ids";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ids = {
  companyA: "00000000-0000-4000-8000-000000000010",
  companyB: "00000000-0000-4000-8000-000000000011",
  personA: "00000000-0000-4000-8000-000000000020",
  personB: "00000000-0000-4000-8000-000000000021",
  personC: "00000000-0000-4000-8000-000000000022",
  actor: "00000000-0000-4000-8000-000000000040",
  vendor: "00000000-0000-4000-8000-000000000030",
  account: "00000000-0000-4000-8000-000000000031",
  accountB: "00000000-0000-4000-8000-000000000032",
};
const record = { email: " A@EXAMPLE.TEST ", providerUserId: "user-a", activityDate: "2026-10-03", counters: { chat_metrics: { message_count: 1 } } };
const ingestFromAppClient: (client: typeof import("./index").db, batch: ActivityBatch) => Promise<ActivityBatchResult> = ingestActivityBatch;
const base: ActivityBatch = { companyId: ids.companyA, vendorAccountId: ids.account, activityDate: record.activityDate, source: "api", syncedAt: new Date("2026-10-06T11:00:00Z"), actorUserAccountId: null, records: [record] };
let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let initialModes: { mode: string; ingestion_mode: string }[];
let db: ReturnType<typeof drizzle<typeof schema>>;
beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  db = drizzle(pool, { schema });
  for (const [id, code] of [[ids.companyA, "A"], [ids.companyB, "B"]]) {
    await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,$2,$2,'internal','active','2026-10-01',$3)`, [id, code, SYSTEM_USER_ID]);
  }
  for (const [id, email, company] of [[ids.personA, "a@example.test", ids.companyA], [ids.personB, "b@example.test", ids.companyB], [ids.personC, "c@example.test", ids.companyA]]) {
    await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,$2,$2,$3,'active','2026-10-01',$4)`, [id,email,company,SYSTEM_USER_ID]);
  }
  await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,'Anthropic','api','rest',true,true,true,true,'email','active','2026-10-01',$2)`, [ids.vendor,SYSTEM_USER_ID]);
  for (const [id, mode] of [[ids.account, "automated"], [ids.accountB, "orchestration"]]) {
    await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,$3::text,$3::text::vendor_account_mode_enum,0,'active','2026-10-01',$4)`, [id,ids.vendor,mode,SYSTEM_USER_ID]);
  }
  await owner.query("INSERT INTO user_account(id,email,status,created_at) VALUES($1,'actor@example.test','active','2026-10-01')",[ids.actor]);
  initialModes=(await owner.query("SELECT mode,ingestion_mode FROM vendor_account ORDER BY mode")).rows;
}, 150_000);
afterAll(async () => { await pool?.end(); await owner?.end(); await fixture?.stop(); });
beforeEach(async () => {
  await owner.query("TRUNCATE activity_record, cost_record, audit_log");
  await owner.query("UPDATE vendor_account SET ingestion_mode='api',status='active'");
  await owner.query("UPDATE vendor SET identity_matching='email',status='active'");
});
const rows = () => db.select().from(schema.activityRecord);
const audits = () => db.select().from(schema.auditLog).orderBy(schema.auditLog.occurredAt,schema.auditLog.id);

// Fault: INSERT-only ingestion, wrong natural key, absent company predicate, or stale update.
test("refreshes one natural key while preserving its ID and company", async () => {
  expect(await db.transaction(tx=>ingestActivityBatch(tx,base))).toEqual({written:1,ignored:0,warnings:[]});
  const before=await rows();
  const newer={...base,syncedAt:new Date("2026-10-06T12:00:00Z"),records:[{...record,counters:{chat_metrics:{message_count:9}}}]};
  expect((await ingestFromAppClient(db,newer)).written).toBe(1);
  const after=await rows();
  expect(after.map(row=>row.id)).toEqual(before.map(row=>row.id));
  expect(after).toHaveLength(1);
  expect(after[0].personId).toBe(ids.personA);
  expect(after[0].counters).toEqual({chat_metrics:{message_count:9}});
  expect(after[0].syncedAt.toISOString()).toBe("2026-10-06T12:00:00.000Z");
  expect((await ingestActivityBatch(db,base)).ignored).toBe(1);
  expect(await rows()).toEqual(after);
  expect((await ingestActivityBatch(db,newer)).ignored).toBe(1);
  expect(await rows()).toEqual(after);
  expect(after.some(row=>row.personId===ids.personB)).toBe(false);
});

// Fault: equal timestamps choose scheduling order or JSON serialization order; missing rollback.
test("rejects contradictory equal retries atomically and compares JSONB values", async () => {
  const input={...base,records:[{...record,counters:{chat_metrics:{message_count:1,thinking_message_count:2}}}]};
  await ingestActivityBatch(db,input);
  expect((await ingestActivityBatch(db,{...input,records:[{...record,counters:{chat_metrics:{thinking_message_count:2,message_count:1}}}]})).ignored).toBe(1);
  const before=await rows(),auditBefore=await audits();
  await expect(ingestActivityBatch(db,{...base,records:[{...record,email:"c@example.test",providerUserId:"user-c"},{...record,counters:{chat_metrics:{message_count:99}}}]})).rejects.toThrow();
  expect(await rows()).toEqual(before);expect(await audits()).toEqual(auditBefore);
});

// Fault: check-then-insert race, omitted account key, contradictory duplicate acceptance.
test("serializes concurrent conflicts and keeps account keys independent", async () => {
  const result=await Promise.all([ingestActivityBatch(db,base),ingestActivityBatch(db,base)]);
  expect(result.map(r=>r.written).sort()).toEqual([0,1]);
  expect(await rows()).toHaveLength(1);
  const contradiction={...base,syncedAt:new Date("2026-10-06T12:00:00Z"),records:[{...record,counters:{chat_metrics:{message_count:2}}}]};
  const conflicts=await Promise.allSettled([ingestActivityBatch(db,{...base,syncedAt:contradiction.syncedAt}),ingestActivityBatch(db,contradiction)]);
  expect(conflicts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(conflicts.filter(r=>r.status==='rejected')).toHaveLength(1);
  await ingestActivityBatch(db,{...base,vendorAccountId:ids.accountB});
  expect((await rows()).map(r=>r.vendorAccountId).sort()).toEqual([ids.account,ids.accountB]);
});

// Fault: matching outside company scope or misclassifying global routing warnings.
test("retains scoped warnings and groups globally authorized records once", async () => {
  const foreign={...record,email:"b@example.test",providerUserId:"user-b"};
  const missing={...record,email:null,providerUserId:"missing-user"};
  expect(await ingestActivityBatch(db,{...base,records:[foreign,missing]})).toEqual({written:0,ignored:0,warnings:[{recordIndex:0,reason:"unmatched_email",email:"b@example.test",providerUserId:"user-b"},{recordIndex:1,reason:"missing_email",email:null,providerUserId:"missing-user"}]});
  expect(await rows()).toEqual([]);
  const log=await audits();
  expect(log.filter(r=>r.action==="analytics_activity_sync")).toHaveLength(1);
  expect(log.filter(r=>r.action==="analytics_activity_warning")).toHaveLength(2);
  expect(log.every(r=>r.companyId===ids.companyA)).toBe(true);
  expect(log.every(r=>r.entityType==="VendorAccount" && r.entityId===ids.account)).toBe(true);
  expect(log.filter(r=>r.action==="analytics_activity_warning").map(r=>r.after)).toEqual(expect.arrayContaining([{vendorAccountId:ids.account,activityDate:"2026-10-03",source:"api",recordIndex:0,reason:"unmatched_email",email:"b@example.test",providerUserId:"user-b"},{vendorAccountId:ids.account,activityDate:"2026-10-03",source:"api",recordIndex:1,reason:"missing_email",email:null,providerUserId:"missing-user"}]));
  const unknown={...record,email:"unknown@example.test",providerUserId:"unknown-user"};
  const scoped=await resolveActivityScopes(db,[ids.companyA,ids.companyB,ids.companyA],[record,foreign,missing,unknown]);
  expect(scoped.batches.map(b=>({companyId:b.companyId,emails:b.records.map(r=>r.email)}))).toEqual([{companyId:ids.companyA,emails:["a@example.test"]},{companyId:ids.companyB,emails:["b@example.test"]}]);
  expect(scoped.warnings.map(w=>({recordIndex:w.recordIndex,reason:w.reason}))).toEqual([{recordIndex:2,reason:"missing_email"},{recordIndex:3,reason:"unmatched_email"}]);
  expect((await resolveActivityScopes(db,[ids.companyA],[foreign])).warnings[0].reason).toBe("unmatched_email");
});

// Fault: ignoring ingestion switch; conflating it with provisioning; arbitrary replay persistence.
test("holds API eligibility at persistence and writes explicit source-safe replay", async () => {
  await owner.query("UPDATE vendor_account SET ingestion_mode='manual'");
  expect(await ingestActivityBatch(db,base)).toEqual({written:0,ignored:1,warnings:[]});
  expect(await rows()).toEqual([]);
  for (const [index,source] of (["csv_import","manual","api"] as const).entries()) {
    if(source==='api')await owner.query("UPDATE vendor_account SET ingestion_mode='api'");
    await ingestActivityBatch(db,{...base,source,syncedAt:new Date(`2026-10-06T1${index+2}:00:00Z`),records:[{...record,counters:{chat_metrics:{message_count:4,secret:"token"},headers:{Authorization:"secret"}}}]});
    const [persisted]=await rows();
    expect(persisted.source).toBe(source);
    expect(persisted.rawPayload).toEqual({version:1,vendorAccountId:ids.account,activityDate:"2026-10-03",source,identity:{email:"a@example.test",providerUserId:"user-a"},counters:{chat_metrics:{message_count:4}}});
    const summary=(await audits()).filter(r=>r.action==='analytics_activity_sync').at(-1)!;
    expect(summary.actorUserId).toBe(SYSTEM_USER_ID);
    expect(summary.after).toEqual({vendorAccountId:ids.account,activityDate:"2026-10-03",source,written:1,ignored:0,warningCount:0});
  }
});

// Fault: partial writes before validation, impossible calendar dates, invalid identity/counters.
test("validates full batches before writes and collapses equivalent duplicates", async () => {
  const invalids=[{...base,companyId:"bad"},{...base,vendorAccountId:"bad"},{...base,actorUserAccountId:"bad"},{...base,syncedAt:new Date(NaN)},{...base,activityDate:"2026-02-30"},{...base,source:"bad"},
    ...[{...record,activityDate:"2026-10-02"},{...record,email:"bad"},{...record,providerUserId:4},{...record,counters:{chat_metrics:{message_count:-1}}},{...record,counters:{chat_metrics:{message_count:0.5}}}].map(r=>({...base,records:[record,r]})),
    {...base,records:[{...record,email:null},{...record,email:null,counters:{chat_metrics:{message_count:2}}}]},
    {...base,records:[record,{...record,providerUserId:"other"}]},{...base,records:[record,{...record,counters:{chat_metrics:{message_count:2}}}]}];
  for(const input of invalids)await expect(ingestActivityBatch(db,input as ActivityBatch)).rejects.toThrow();
  expect(await rows()).toEqual([]);expect(await audits()).toEqual([]);
  expect((await ingestActivityBatch(db,{...base,records:[record,{...record,email:"a@example.test"}]})).written).toBe(1);
  expect(await rows()).toHaveLength(1);
  const missing={...record,email:null};
  expect((await ingestActivityBatch(db,{...base,records:[missing,missing]})).warnings).toHaveLength(1);
});

// Fault: unconstrained column/table grants; failing audit leaves unaccounted rows.
test("permits refresh columns only and rolls back on audit insert failure", async () => {
  await ingestActivityBatch(db,base);
  for(const column of ["id","vendor_account_id","person_id","activity_date"]){
    await expect(pool.query(`UPDATE activity_record SET ${column}=${column}`)).rejects.toMatchObject({code:"42501"});
  }
  await expect(pool.query("DELETE FROM activity_record")).rejects.toMatchObject({code:"42501"});
  const before=await rows(),auditBefore=await audits();
  await owner.query("REVOKE INSERT ON audit_log FROM ledger_app");
  try {
    await expect(ingestActivityBatch(db,{...base,syncedAt:new Date("2026-10-06T12:00:00Z")})).rejects.toThrow();
    expect(await rows()).toEqual(before);expect(await audits()).toEqual(auditBefore);
  } finally {await owner.query("GRANT INSERT ON audit_log TO ledger_app");}
});

// Fault: wrong defaults for previously provisioned accounts; missing migration/backfill.
test("defaults both provisioning modes to manual ingestion", async () => {
  expect(initialModes).toEqual([{mode:"automated",ingestion_mode:"manual"},{mode:"orchestration",ingestion_mode:"manual"}]);
  const result=await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES('00000000-0000-4000-8000-000000000033',$1,'new','automated',0,'active','2026-10-01',$2) RETURNING ingestion_mode`,[ids.vendor,SYSTEM_USER_ID]);
  expect(result.rows).toEqual([{ingestion_mode:"manual"}]);
  const defaults=await owner.query(`SELECT column_default FROM information_schema.columns WHERE table_name='vendor_account' AND column_name='ingestion_mode'`);
  expect(defaults.rows[0].column_default).toBe("'manual'::ingestion_source");
});

// Fault: copying unknown secrets, inventing zeros, accepting malformed nesting/counts.
test("normalizes allowlisted counters without manufacturing missing values", () => {
  expect(normalizeActivityCounters({chat_metrics:null,claude_code_metrics:{core_metrics:{commit_count:null,lines_of_code:{added_count:3,removed_count:0,secret:"x"}},tool_actions:{edit_tool:{accepted_count:2,rejected_count:null,secret:"x"}},secret:"x"},cowork_metrics:{message_count:4,secret:"x"},secret:"x"})).toEqual({chat_metrics:null,claude_code_metrics:{core_metrics:{commit_count:null,lines_of_code:{added_count:3,removed_count:0}},tool_actions:{edit_tool:{accepted_count:2,rejected_count:null}}},cowork_metrics:{message_count:4}});
  expect(normalizeActivityCounters({})).toEqual({});
  for(const counters of [null,[],{chat_metrics:[]},{cowork_metrics:{message_count:Infinity}},{cowork_metrics:{message_count:"1"}},{claude_code_metrics:{tool_actions:{edit_tool:3}}}])expect(()=>normalizeActivityCounters(counters)).toThrow();
});


// Fault: migration only changes new-row defaults and leaves legacy provisioning modes API-enabled.
test("backfills existing automated and orchestration accounts through committed migration history", async () => {
  const name = `${fixture.databaseName}_upgrade`;
  const oldUrl = new URL(fixture.ownerUrl); oldUrl.pathname = `/${name}`;
  const directory = await mkdtemp(join(tmpdir(), "ledger-activity-upgrade-"));
  const legacy = new pg.Client({connectionString:oldUrl.toString()});
  try {
    await owner.query(`CREATE DATABASE "${name}" OWNER ledger_owner`);
    const migrationDirectory=join(packageRoot,"src/migrations");
    const files=(await readdir(migrationDirectory)).filter(file=>file.endsWith(".sql") && file < "V20261006013000__analytics_activity_ingestion.sql");
    await Promise.all(files.map(file=>cp(join(migrationDirectory,file),join(directory,file))));
    const {applyMigrations}=await import(pathToFileURL(join(packageRoot,"scripts/apply-migrations.mjs")).href);
    await applyMigrations({databaseAdminUrl:oldUrl.toString(),migrationsDirectory:directory});
    await legacy.connect();
    await legacy.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,'Legacy','api','rest',true,true,true,true,'email','active','2026-10-01',$2)`,[ids.vendor,SYSTEM_USER_ID]);
    for(const [id,mode] of [[ids.account,"automated"],[ids.accountB,"orchestration"]])await legacy.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,$3::text,$3::text::vendor_account_mode_enum,0,'active','2026-10-01',$4)`,[id,ids.vendor,mode,SYSTEM_USER_ID]);
    await applyMigrations({databaseAdminUrl:oldUrl.toString()});
    expect((await legacy.query("SELECT mode,ingestion_mode FROM vendor_account ORDER BY mode")).rows).toEqual([{mode:"automated",ingestion_mode:"manual"},{mode:"orchestration",ingestion_mode:"manual"}]);
  } finally {
    await legacy.end();
    await owner.query(`DROP DATABASE IF EXISTS "${name}"`);
    await rm(directory,{recursive:true,force:true});
  }
},150_000);


// Faults: disabled validators fall through to PostgreSQL or silently accept
// invalid empty/global batches; opaque service codes distinguish the intended
// rejected contract from incidental SQL/TypeError failures.
test("rejects malformed global identities and batches at the service boundary", async () => {
  for(const companyId of ["bad", `prefix${ids.companyA}`, `${ids.companyA}suffix`, 4, [ids.companyA]]) {
    await expect(resolveActivityScopes(db,[companyId] as string[],[])).rejects.toThrow("ACTIVITY_INVALID_UUID");
  }
  const invalidRecords: [unknown,string][] = [
    [null,"ACTIVITY_INVALID_RECORDS"], [{},"ACTIVITY_INVALID_RECORDS"],
    [[null],"ACTIVITY_INVALID_RECORD"], [[1],"ACTIVITY_INVALID_RECORD"],
    [[{...record,email:4}],"ACTIVITY_INVALID_EMAIL"],
    [[{...record,email:new String("a@example.test")}],"ACTIVITY_INVALID_EMAIL"],
    [[{...record,email:"@@a@example.test"}],"ACTIVITY_INVALID_EMAIL"],
    [[{...record,email:"a@example.test@"}],"ACTIVITY_INVALID_EMAIL"],
    [[{...record,activityDate:"2026-02-30"}],"ACTIVITY_INVALID_DATE"],
    [[{...record,activityDate:"2026-10-3"}],"ACTIVITY_INVALID_DATE"],
    [[{...record,providerUserId:4}],"ACTIVITY_INVALID_PROVIDER_ID"],
    [[record,{...record,email:"b@example.test"}],"ACTIVITY_IDENTITY_CONFLICT"],
    [[record,{...record,counters:{chat_metrics:{message_count:2}}}],"ACTIVITY_DUPLICATE_CONFLICT"],
  ];
  for(const [records,code] of invalidRecords)await expect(resolveActivityScopes(db,[ids.companyA],records as Parameters<typeof resolveActivityScopes>[2])).rejects.toThrow(code);
  for(const [input,code] of [
    [{...base,source:"invalid",records:[]},"ACTIVITY_INVALID_SOURCE"],
    [{...base,syncedAt:new Date(NaN),records:[]},"ACTIVITY_INVALID_SYNC_TIME"],
    [{...base,syncedAt:"2026-10-06",records:[]},"ACTIVITY_INVALID_SYNC_TIME"],
    [{...base,actorUserAccountId:"bad"},"ACTIVITY_INVALID_UUID"],
    [{...base,records:[{...record,activityDate:"2026-10-02"}]},"ACTIVITY_DATE_MISMATCH"],
  ] as const)await expect(ingestActivityBatch(db,input as ActivityBatch)).rejects.toThrow(code);
  expect(await rows()).toEqual([]);expect(await audits()).toEqual([]);
});

// Faults: coercing/tracking null provider identities, dropping provider-ID
// conflicts, collapsing unrelated missing identities, losing nullable retries.
test("keeps anonymous records distinct and accepts nullable identity retries", async () => {
  const nullable={...record,providerUserId:null,counters:{chat_metrics:{message_count:null}}};
  expect((await ingestActivityBatch(db,{...base,records:[nullable,nullable]})).written).toBe(1);
  expect((await ingestActivityBatch(db,{...base,records:[nullable]})).ignored).toBe(1);
  expect((await rows())[0].rawPayload).toEqual({version:1,vendorAccountId:ids.account,activityDate:"2026-10-03",source:"api",identity:{email:"a@example.test",providerUserId:null},counters:{chat_metrics:{message_count:null}}});
  const scoped=await resolveActivityScopes(db,[ids.companyA,ids.companyB],[nullable,{...nullable,email:"b@example.test"}]);
  expect(scoped.batches.map(b=>b.companyId)).toEqual([ids.companyA,ids.companyB]);
  const missing=await resolveActivityScopes(db,[ids.companyA],[{...record,email:null,providerUserId:null},{...record,email:null,providerUserId:null,counters:{chat_metrics:{message_count:2}}},{...record,email:null,providerUserId:"missing-a"},{...record,email:null,providerUserId:"missing-b"}]);
  expect(missing.batches).toEqual([]);
  expect(missing.warnings.map(w=>w.recordIndex)).toEqual([0,1,2,3]);
});

// Fault #137: choosing provider-only keys for matched emails bypasses email
// duplicate collapse and contradictory same-email rejection.
test("deduplicates by normalized email even with nullable or distinct provider IDs", async () => {
  const nullable={...record,providerUserId:null};
  const collapsed=await resolveActivityScopes(db,[ids.companyA,ids.companyB],[nullable,{...nullable,email:"a@example.test"}]);
  expect(collapsed).toEqual({batches:[{companyId:ids.companyA,records:[{...nullable,email:"a@example.test"}]}],warnings:[]});
  for (const records of [
    [nullable,{...nullable,counters:{chat_metrics:{message_count:2}}}],
    [record,{...record,providerUserId:"another-provider-id"}],
  ]) {
    await expect(resolveActivityScopes(db,[ids.companyA,ids.companyB],records)).rejects.toThrow("ACTIVITY_DUPLICATE_CONFLICT");
    await expect(ingestActivityBatch(db,{...base,records})).rejects.toThrow("ACTIVITY_DUPLICATE_CONFLICT");
  }
  expect(await rows()).toEqual([]);
  expect(await audits()).toEqual([]);
});

// Fault I1: provider-only identity text collides with an unrelated email key.
test("separates provider-only and email duplicate identity namespaces", async () => {
  const email="provider:x@example.test";
  const missing={...record,email:null,providerUserId:"x@example.test"};
  const matched={...record,email,providerUserId:null,counters:{chat_metrics:{message_count:7}}};
  const expectedWarning={recordIndex:0,reason:"missing_email",email:null,providerUserId:"x@example.test"};
  await owner.query("UPDATE person SET email=$1 WHERE id=$2",[email,ids.personA]);
  try {
    const scoped=await resolveActivityScopes(db,[ids.companyA,ids.companyB],[missing,matched]);
    expect(scoped.warnings).toEqual([expectedWarning]);
    expect(scoped.batches).toEqual([{companyId:ids.companyA,records:[matched]}]);
    expect(await ingestActivityBatch(db,{...base,records:[missing,matched]})).toEqual({written:1,ignored:0,warnings:[expectedWarning]});
    const persisted=await rows();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({personId:ids.personA,counters:matched.counters});
    expect((await owner.query("SELECT company_id FROM person WHERE id=$1",[persisted[0].personId])).rows).toEqual([{company_id:ids.companyA}]);
    expect((await audits()).filter(row=>row.action==="analytics_activity_warning").map(row=>row.after)).toEqual([{vendorAccountId:ids.account,activityDate:record.activityDate,source:"api",...expectedWarning}]);
  } finally {await owner.query("UPDATE person SET email='a@example.test' WHERE id=$1",[ids.personA]);}
});

// Faults: unsupported matching silently ingests, missing company/actor permits
// summary-only writes, human identity confused with intentionally disabled system.
test("requires supported accounts, existing companies and verified audit actors", async () => {
  const empty={...base,records:[]};
  await owner.query("UPDATE vendor SET identity_matching='vendor_user_id'");
  try {await expect(ingestActivityBatch(db,empty)).rejects.toThrow("ACTIVITY_ACCOUNT_UNSUPPORTED");}
  finally {await owner.query("UPDATE vendor SET identity_matching='email'");}
  await expect(ingestActivityBatch(db,{...empty,vendorAccountId:"00000000-0000-4000-8000-000000000099"})).rejects.toThrow("ACTIVITY_ACCOUNT_UNSUPPORTED");
  await expect(ingestActivityBatch(db,{...empty,companyId:"00000000-0000-4000-8000-000000000099"})).rejects.toThrow("ACTIVITY_COMPANY_NOT_FOUND");
  await expect(ingestActivityBatch(db,{...empty,actorUserAccountId:"00000000-0000-4000-8000-000000000099"})).rejects.toThrow("ACTIVITY_ACTOR_NOT_FOUND");
  await owner.query("UPDATE user_account SET status='disabled' WHERE id=$1",[ids.actor]);
  try {await expect(ingestActivityBatch(db,{...empty,actorUserAccountId:ids.actor})).rejects.toThrow("ACTIVITY_ACTOR_NOT_FOUND");}
  finally {await owner.query("UPDATE user_account SET status='active' WHERE id=$1",[ids.actor]);}
  expect(await rows()).toEqual([]);expect(await audits()).toEqual([]);
  await ingestActivityBatch(db,{...base,actorUserAccountId:ids.actor});
  expect((await audits())[0].actorUserId).toBe(ids.actor);
  await expect(ingestActivityBatch(db,{...base,records:[{...record,counters:{chat_metrics:{message_count:7}}}]})).rejects.toThrow("ACTIVITY_REPLAY_CONFLICT");
});

// Faults: trim-equivalent legacy identities choose row/order instead of
// rejecting ambiguity. Global lower(email) uniqueness permits these real rows.
test("rejects ambiguous trimmed identities within and across authorized companies", async () => {
  await owner.query("UPDATE person SET email=' a@example.test ' WHERE id=$1",[ids.personC]);
  try {await expect(ingestActivityBatch(db,base)).rejects.toThrow("ACTIVITY_AMBIGUOUS_IDENTITY");}
  finally {await owner.query("UPDATE person SET email='c@example.test' WHERE id=$1",[ids.personC]);}
  await owner.query("UPDATE person SET email=' a@example.test ' WHERE id=$1",[ids.personB]);
  try {await expect(resolveActivityScopes(db,[ids.companyA,ids.companyB],[record])).rejects.toThrow("ACTIVITY_AMBIGUOUS_IDENTITY");}
  finally {await owner.query("UPDATE person SET email='b@example.test' WHERE id=$1",[ids.personB]);}
  expect(await rows()).toEqual([]);expect(await audits()).toEqual([]);
});

// Fault: matched Person can move companies between matching and persistence.
// A real relation lock holds INSERT after matching. We observe its actual
// PostgreSQL wait state, then prove Person movement cannot acquire its row lock.
test("holds the matched Person scope until activity persistence commits", async () => {
  const updater=await fixture.connectAsOwner();
  let ingestion: Promise<ActivityBatchResult> | undefined;
  await owner.query("BEGIN");
  try {
    await owner.query("LOCK TABLE activity_record IN SHARE MODE");
    ingestion=ingestActivityBatch(db,base);
    // This is a bounded progress observation, not a sleep to guess execution
    // order. The INSERT wait is the synchronization event establishing matching.
    let waiting=false;
    for(let attempt=0;attempt<1000;attempt++) {
      const lock=await updater.query<{waiting:boolean}>(`SELECT EXISTS(
        SELECT 1 FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND relation='activity_record'::regclass AND mode='RowExclusiveLock' AND NOT granted) AS waiting`);
      if(lock.rows[0].waiting){waiting=true;break;}
    }
    expect(waiting).toBe(true);
    await updater.query("SET lock_timeout='250ms'");
    await expect(updater.query("UPDATE person SET company_id=$1 WHERE id=$2",[ids.companyB,ids.personA])).rejects.toMatchObject({code:"55P03"});
  } finally {
    await owner.query("ROLLBACK");
    await updater.end();
    if(ingestion)await ingestion;
  }
  const persisted=await rows();
  expect(persisted.map(row=>row.personId)).toEqual([ids.personA]);
  expect((await owner.query("SELECT company_id FROM person WHERE id=$1",[ids.personA])).rows).toEqual([{company_id:ids.companyA}]);
});


const cost = {email:" A@EXAMPLE.TEST ",providerUserId:"cost-a",costDate:"2026-10-05",amountUsd:"-1.2345",amountCents:"-123.45"};
const costBase: CostBatch = {companyId:ids.companyA,vendorAccountId:ids.account,costDate:cost.costDate,source:"api",syncedAt:new Date("2026-10-06T11:00:00Z"),windowAt:new Date("2026-10-06T12:00:00Z"),actorUserAccountId:null,records:[cost]};
const costRows = () => db.select().from(schema.costRecord).orderBy(schema.costRecord.vendorAccountId,schema.costRecord.personId,schema.costRecord.costDate);

// Fault: rounding cents, stale overwrites, source omission, unstable JSON equality.
test("revises signed exact cost natural keys and rejects equal-time contradictions atomically", async () => {
  expect(await db.transaction(tx=>ingestCostBatch(tx,costBase))).toEqual({written:1,ignored:0,warnings:[]});
  const first=await costRows();
  expect(first[0]).toMatchObject({personId:ids.personA,amountUsd:"-1.2345",source:"api",rawPayload:{version:1,vendorAccountId:ids.account,costDate:"2026-10-05",source:"api",identity:{email:"a@example.test",providerUserId:"cost-a"},amountUsd:"-1.2345",amountCents:"-123.45"}});
  const newer={...costBase,source:"csv_import" as const,syncedAt:new Date("2026-10-06T12:00:00Z"),records:[{...cost,amountUsd:"0.0001",amountCents:null}]};
  expect((await ingestCostBatch(db,newer)).written).toBe(1);
  const revised=await costRows();
  expect(revised[0]).toMatchObject({id:first[0]!.id,amountUsd:"0.0001",source:"csv_import",syncedAt:newer.syncedAt});
  expect((await ingestCostBatch(db,costBase)).ignored).toBe(1);
  expect((await ingestCostBatch(db,newer)).ignored).toBe(1);
  await owner.query("UPDATE cost_record SET raw_payload=jsonb_build_object('amountCents',null,'amountUsd','0.0001','identity',jsonb_build_object('providerUserId','cost-a','email','a@example.test'),'source','csv_import','costDate','2026-10-05','vendorAccountId',$1::text,'version',1)",[ids.account]);
  expect((await ingestCostBatch(db,newer)).ignored).toBe(1);
  const before=await costRows(),log=await audits();
  await expect(ingestCostBatch(db,{...newer,records:[{...cost,email:"c@example.test",providerUserId:"c",amountCents:null},{...cost,amountUsd:"7",amountCents:null}]})).rejects.toThrow("COST_REPLAY_CONFLICT");
  expect(await costRows()).toEqual(before);expect(await audits()).toEqual(log);
});

// Fault: provider account acting as tenant, skipped company identity and warning audit.
test("routes cost identities by trusted companies and durably warns without retaining provider blobs", async () => {
  const foreign={...cost,email:"b@example.test",providerUserId:"b"};
  const missing={...cost,email:null,providerUserId:"missing"};
  const unknown={...cost,email:"unknown@example.test",providerUserId:null};
  const routed=await resolveCostScopes(db,[ids.companyA,ids.companyB,ids.companyA],[cost,foreign,missing,unknown]);
  expect(routed.batches.map(b=>({companyId:b.companyId,emails:b.records.map(r=>r.email)}))).toEqual([{companyId:ids.companyA,emails:["a@example.test"]},{companyId:ids.companyB,emails:["b@example.test"]}]);
  expect(routed.warnings).toEqual([{recordIndex:2,reason:"missing_email",email:null,providerUserId:"missing"},{recordIndex:3,reason:"unmatched_email",email:"unknown@example.test",providerUserId:null}]);
  expect(await ingestCostBatch(db,{...costBase,records:[cost,foreign,missing,unknown].map(r=>({...r,secret:"never-store"}))})).toEqual({written:1,ignored:0,warnings:[{recordIndex:1,reason:"unmatched_email",email:"b@example.test",providerUserId:"b"},{recordIndex:2,reason:"missing_email",email:null,providerUserId:"missing"},{recordIndex:3,reason:"unmatched_email",email:"unknown@example.test",providerUserId:null}]});
  expect((await costRows()).map(r=>r.personId)).toEqual([ids.personA]);
  expect(JSON.stringify(await costRows())).not.toContain("never-store");
  const log=await audits();
  expect(log.every(r=>r.companyId===ids.companyA && r.actorUserId===SYSTEM_USER_ID)).toBe(true);
  expect(log.filter(r=>r.action==="analytics_cost_warning").map(r=>r.after)).toEqual(expect.arrayContaining([{vendorAccountId:ids.account,costDate:cost.costDate,source:"api",recordIndex:2,reason:"missing_email",email:null,providerUserId:"missing"}]));
  expect(log.find(r=>r.action==="analytics_cost_sync")!.after).toEqual({vendorAccountId:ids.account,costDate:cost.costDate,source:"api",written:1,ignored:0,warningCount:3});
});

// Fault: wrong inclusive/exclusive UTC boundary or window derived from syncedAt.
test("guards all cost sources with the injected thirty completed UTC dates", async () => {
  for(const source of ["api","manual","csv_import"] as const)for(const [costDate,eligible] of [["2026-09-05",false],["2026-09-06",true],["2026-10-05",true],["2026-10-06",false]] as const){
    const input={...costBase,source,costDate,syncedAt:new Date("2026-10-07T00:00:00Z"),records:[{...cost,costDate}]};
    await owner.query("TRUNCATE cost_record,audit_log");
    expect(await ingestCostBatch(db,input)).toEqual({written:eligible?1:0,ignored:eligible?0:1,warnings:[]});
    expect(await costRows()).toHaveLength(eligible?1:0);
    if(eligible){
      const before=await costRows();
      expect((await ingestCostBatch(db,{...input,windowAt:new Date("2026-12-01"),syncedAt:new Date("2026-12-01"),records:[{...cost,costDate,amountUsd:"9",amountCents:null}]})).ignored).toBe(1);
      expect(await costRows()).toEqual(before);
    }
  }
});

// Fault: API opt-in bypass, manual/CSV blocked by API setting or account key omitted.
test("enforces API opt-in while independent manual and CSV observations obey freshness", async () => {
  await owner.query("UPDATE vendor_account SET ingestion_mode='manual'");
  expect(await ingestCostBatch(db,costBase)).toEqual({written:0,ignored:1,warnings:[]});
  expect(await costRows()).toEqual([]);
  for(const source of ["manual","csv_import"] as const){
    const vendorAccountId=source==="manual"?ids.account:ids.accountB;
    expect((await ingestCostBatch(db,{...costBase,source,vendorAccountId,actorUserAccountId:ids.actor})).written).toBe(1);
  }
  expect((await costRows()).map(r=>[r.vendorAccountId,r.personId,r.source])).toEqual([[ids.account,ids.personA,"manual"],[ids.accountB,ids.personA,"csv_import"]]);
  expect((await audits()).filter(r=>r.action==="analytics_cost_sync" && (r.after as {source:string}).source!=="api").every(r=>r.actorUserId===ids.actor)).toBe(true);
  const before=await costRows();
  await expect(ingestCostBatch(db,{...costBase,source:"csv_import"})).rejects.toThrow("COST_REPLAY_CONFLICT");
  expect(await costRows()).toEqual(before);
});

// Fault: partial writes, implicit numeric SQL rounding, invalid original cents accepted.
test("validates every cost before writes including seeded signed precision and bounds", async () => {
  let state=7106;
  for(let i=0;i<16;i++){
    state=(state*1664525+1013904223)>>>0;
    const amountUsd=`${state%2?"-":""}${state%10000}.12345`;
    await expect(ingestCostBatch(db,{...costBase,records:[cost,{...cost,email:"c@example.test",providerUserId:"c",amountUsd,amountCents:null}]})).rejects.toThrow();
  }
  for(const patch of [{amountUsd:"100000000"},{amountUsd:"-100000000"},{amountUsd:"1e2"},{amountUsd:NaN},{amountUsd:"Infinity"},{amountUsd:1},{amountCents:"1.001"},{amountCents:"-123.44"},{amountCents:4},{email:"bad"},{providerUserId:4},{costDate:"2026-02-30"},{costDate:"2026-10-04"}]){
    await expect(ingestCostBatch(db,{...costBase,records:[cost,{...cost,email:"c@example.test",providerUserId:"c",...patch}]} as CostBatch)).rejects.toThrow();
  }
  for(const patch of [{companyId:"bad"},{vendorAccountId:"bad"},{actorUserAccountId:"bad"},{source:"bad"},{syncedAt:new Date(NaN)},{windowAt:new Date(NaN)},{windowAt:"2026-10-06"},{costDate:"2026-02-30"},{records:null},{records:[null]}])await expect(ingestCostBatch(db,{...costBase,...patch} as CostBatch)).rejects.toThrow();
  expect(await costRows()).toEqual([]);expect(await audits()).toEqual([]);
  for(const amountUsd of ["99999999.9999","-99999999.9999","0"]){
    const input={...costBase,syncedAt:new Date(costBase.syncedAt.getTime()+1000),records:[{...cost,amountUsd,amountCents:null}]};
    await owner.query("TRUNCATE cost_record,audit_log");
    expect((await ingestCostBatch(db,input)).written).toBe(1);
    expect((await costRows())[0]!.amountUsd).toBe(amountUsd==="0"?"0.0000":amountUsd);
  }
});

// Fault: choosing one ambiguous identity, duplicate conflicts and namespace collision.
test("rejects cost identity ambiguity and conflicting duplicates before mutation", async () => {
  for(const records of [[cost,{...cost,amountUsd:"1",amountCents:null}],[cost,{...cost,providerUserId:"other"}],[cost,{...cost,email:"b@example.test"}]]){
    await expect(ingestCostBatch(db,{...costBase,records})).rejects.toThrow();
    await expect(resolveCostScopes(db,[ids.companyA,ids.companyB],records)).rejects.toThrow();
  }
  await owner.query("UPDATE person SET email=' a@example.test ' WHERE id=$1",[ids.personC]);
  try{await expect(ingestCostBatch(db,costBase)).rejects.toThrow("COST_AMBIGUOUS_IDENTITY");}
  finally{await owner.query("UPDATE person SET email='c@example.test' WHERE id=$1",[ids.personC]);}
  await owner.query("UPDATE person SET email=' a@example.test ' WHERE id=$1",[ids.personB]);
  try{await expect(resolveCostScopes(db,[ids.companyA,ids.companyB],[cost])).rejects.toThrow("COST_AMBIGUOUS_IDENTITY");}
  finally{await owner.query("UPDATE person SET email='b@example.test' WHERE id=$1",[ids.personB]);}
  expect(await costRows()).toEqual([]);expect(await audits()).toEqual([]);
  expect((await ingestCostBatch(db,{...costBase,records:[cost,{...cost,email:"a@example.test",amountUsd:"-01.234500"}]})).written).toBe(1);
  const nullIdentity={...cost,email:null,providerUserId:null};
  expect((await resolveCostScopes(db,[ids.companyA],[nullIdentity,{...nullIdentity,amountUsd:"1",amountCents:null}])).warnings.map(w=>w.recordIndex)).toEqual([0,1]);
  await expect(resolveCostScopes(db,["bad"],[])).rejects.toThrow();
});

// Fault: unrestricted updates/deletes, dropped source default/key, failed audits leave rows.
test("verifies committed cost migration and narrow app grants with atomic audit failure", async () => {
  const {verifyMigratedSchema}=await import(pathToFileURL(join(packageRoot,"scripts/verify-schema.mjs")).href);
  const verified=await verifyMigratedSchema({databaseAdminUrl:fixture.ownerUrl,applicationUrl:fixture.appUrl});
  expect(verified).toBeDefined();
  expect((await owner.query("SELECT column_default FROM information_schema.columns WHERE table_name='cost_record' AND column_name='source'")).rows).toEqual([{column_default:"'api'::ingestion_source"}]);
  await ingestCostBatch(db,costBase);
  for(const column of ["id","vendor_account_id","person_id","cost_date"])await expect(pool.query(`UPDATE cost_record SET ${column}=${column}`)).rejects.toMatchObject({code:"42501"});
  await expect(pool.query("DELETE FROM cost_record")).rejects.toMatchObject({code:"42501"});
  const before=await costRows(),log=await audits();
  await owner.query("REVOKE INSERT ON audit_log FROM ledger_app");
  try{
    await expect(ingestCostBatch(db,{...costBase,syncedAt:new Date("2026-10-06T12:00:00Z"),records:[{...cost,amountUsd:"4",amountCents:null},{...cost,email:null}]})).rejects.toThrow();
    expect(await costRows()).toEqual(before);expect(await audits()).toEqual(log);
  }finally{await owner.query("GRANT INSERT ON audit_log TO ledger_app");}
});

// Fault: concurrent equal observations both write, missing account/vendor/company/actor checks.
test("serializes cost replays and rejects unsupported scopes and actors", async () => {
  const result=await Promise.all([ingestCostBatch(db,costBase),ingestCostBatch(db,costBase)]);
  expect(result.map(r=>r.written).sort()).toEqual([0,1]);
  expect(await costRows()).toHaveLength(1);
  const log=await audits(),before=await costRows();
  for(const patch of [{companyId:"00000000-0000-4000-8000-000000000099"},{actorUserAccountId:"00000000-0000-4000-8000-000000000099"},{vendorAccountId:"00000000-0000-4000-8000-000000000099"}])await expect(ingestCostBatch(db,{...costBase,...patch,records:[]})).rejects.toThrow();
  for(const query of ["UPDATE vendor SET status='inactive'","UPDATE vendor SET identity_matching='vendor_user_id'","UPDATE vendor_account SET status='inactive'","UPDATE user_account SET status='disabled' WHERE id='00000000-0000-4000-8000-000000000040'"]){
    await owner.query(query);
    try{await expect(ingestCostBatch(db,{...costBase,actorUserAccountId:ids.actor,records:[]})).rejects.toThrow();}
    finally{await owner.query("UPDATE vendor SET status='active',identity_matching='email'");await owner.query("UPDATE vendor_account SET status='active'");await owner.query("UPDATE user_account SET status='active' WHERE id=$1",[ids.actor]);}
  }
  expect(await costRows()).toEqual(before);expect(await audits()).toEqual(log);
});


// Fault: API observations enter unsupported provider accounts; channel gates leak to human imports.
test("requires held API cost support flags while allowing manual and CSV imports", async () => {
  for(const update of ["has_cost_data=false","connector_type='manual'","provisioning_protocol='scim'"]){
    await owner.query(`UPDATE vendor SET ${update}`);
    try{
      await expect(ingestCostBatch(db,costBase)).rejects.toThrow("COST_ACCOUNT_UNSUPPORTED");
      expect(await costRows()).toEqual([]);expect(await audits()).toEqual([]);
      await owner.query("UPDATE vendor_account SET ingestion_mode='manual'");
      expect((await ingestCostBatch(db,costBase)).ignored).toBe(1);
      for(const source of ["manual","csv_import"] as const){
        await owner.query("TRUNCATE cost_record,audit_log");
        expect((await ingestCostBatch(db,{...costBase,source})).written).toBe(1);
      }
    }finally{
      await owner.query("UPDATE vendor SET has_cost_data=true,connector_type='api',provisioning_protocol='rest'");
      await owner.query("UPDATE vendor_account SET ingestion_mode='api'");
      await owner.query("TRUNCATE cost_record,audit_log");
    }
  }
});


// Fault: shared locks released before cost INSERT, scope move/opt-out during commit.
test("retains cost person company account and vendor locks through persistence", async () => {
  const updater=await fixture.connectAsOwner();
  let ingestion: ReturnType<typeof ingestCostBatch> | undefined;
  await owner.query("BEGIN");
  try{
    await owner.query("LOCK TABLE cost_record IN SHARE MODE");
    ingestion=ingestCostBatch(db,costBase);
    let waiting=false;
    for(let attempt=0;attempt<1000;attempt++){
      const result=await updater.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND relation='cost_record'::regclass AND mode='RowExclusiveLock' AND NOT granted) AS waiting");
      if(result.rows[0]!.waiting){waiting=true;break;}
    }
    expect(waiting).toBe(true);
    for(const [table,id] of [["person",ids.personA],["company",ids.companyA],["vendor_account",ids.account],["vendor",ids.vendor]]){
      await updater.query("BEGIN");
      try{await expect(updater.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE NOWAIT`,[id])).rejects.toMatchObject({code:"55P03"});}
      finally{await updater.query("ROLLBACK");}
    }
  }finally{await owner.query("ROLLBACK");await updater.end();if(ingestion)await ingestion;}
  expect((await costRows()).map(r=>r.personId)).toEqual([ids.personA]);
});

// Fault: nested ingestion escapes the caller's day transaction or verifier misses source/key drift.
test("rolls nested cost ingestion back with its outer day and verifies declared cost metadata", async () => {
  await expect(db.transaction(async tx=>{await ingestCostBatch(tx,costBase);throw new Error("DAY_FAILED");})).rejects.toThrow("DAY_FAILED");
  expect(await costRows()).toEqual([]);expect(await audits()).toEqual([]);
  const {verifyMigratedSchema}=await import(pathToFileURL(join(packageRoot,"scripts/verify-schema.mjs")).href);
  const verify=()=>verifyMigratedSchema({databaseAdminUrl:fixture.ownerUrl,applicationUrl:fixture.appUrl});
  const changes=[
    ["ALTER TABLE cost_record ALTER COLUMN source DROP NOT NULL","ALTER TABLE cost_record ALTER COLUMN source SET NOT NULL","cost_record column contract mismatch"],
    ["ALTER TABLE cost_record ALTER COLUMN source SET DEFAULT 'manual'","ALTER TABLE cost_record ALTER COLUMN source SET DEFAULT 'api'","cost_record column contract mismatch"],
    ["ALTER TABLE cost_record DROP CONSTRAINT uq_cost_record_vendor_account_id_person_id_cost_date","ALTER TABLE cost_record ADD CONSTRAINT uq_cost_record_vendor_account_id_person_id_cost_date UNIQUE(vendor_account_id,person_id,cost_date)","cost_record natural key mismatch"],
    ["GRANT UPDATE ON cost_record TO ledger_app","REVOKE UPDATE ON cost_record FROM ledger_app; GRANT UPDATE(amount_usd,raw_payload,source,synced_at) ON cost_record TO ledger_app", "privilege"],
  ];
  for(const [change,restore,message] of changes){
    await owner.query(change!);
    try{await expect(verify()).rejects.toThrow(message);}
    finally{await owner.query(restore!);}
  }
});


// Faults found by preview: disabled global date validation, erased normalized
// duplicate keys, nullable provider IDs treated as a shared identity, weak guards.
test("rejects malformed cost records at the boundary and preserves normalized duplicate identities", async () => {
  const invalids: [unknown,string][]=[
    [null,"COST_INVALID_RECORDS"],[{},"COST_INVALID_RECORDS"],[[null],"COST_INVALID_RECORD"],[[1],"COST_INVALID_RECORD"],
    [[{...cost,costDate:"2026-02-30"}],"COST_INVALID_DATE"],[[{...cost,email:4}],"COST_INVALID_EMAIL"],
    [[{...cost,providerUserId:4}],"COST_INVALID_PROVIDER_ID"],
    [[cost,{...cost,email:"b@example.test"}],"COST_IDENTITY_CONFLICT"],
    [[cost,{...cost,providerUserId:"different"}],"COST_DUPLICATE_CONFLICT"],
    [[{...cost,amountCents:null},{...cost,amountUsd:"2",amountCents:null}],"COST_DUPLICATE_CONFLICT"],
    [[cost,{...cost,amountCents:"-123.450"}],"COST_DUPLICATE_CONFLICT"],
  ];
  for(const [records,code] of invalids)await expect(resolveCostScopes(db,[ids.companyA,ids.companyB],records as Parameters<typeof resolveCostScopes>[2])).rejects.toThrow(code);
  for(const [patch,code] of [
    [{companyId:"bad"},"COST_INVALID_UUID"],[{vendorAccountId:"bad"},"COST_INVALID_UUID"],[{actorUserAccountId:"bad"},"COST_INVALID_UUID"],
    [{costDate:"2026-02-30"},"COST_INVALID_DATE"],[{source:"invalid",records:[]},"COST_INVALID_SOURCE"],
    [{syncedAt:new Date(NaN)},"COST_INVALID_SYNC_TIME"],[{syncedAt:"2026-10-06"},"COST_INVALID_SYNC_TIME"],
    [{windowAt:new Date(NaN)},"COST_INVALID_WINDOW_TIME"],[{windowAt:"2026-10-06"},"COST_INVALID_WINDOW_TIME"],
  ] as const)await expect(ingestCostBatch(db,{...costBase,...patch} as CostBatch)).rejects.toThrow(code);
  const normalized={...cost,email:"a@example.test"};
  expect(await resolveCostScopes(db,[ids.companyA],[cost,normalized])).toEqual({batches:[{companyId:ids.companyA,records:[normalized]}],warnings:[]});
  expect(await ingestCostBatch(db,{...costBase,records:[cost,normalized]})).toEqual({written:1,ignored:0,warnings:[]});
  const nullable={...normalized,providerUserId:null};
  expect((await resolveCostScopes(db,[ids.companyA,ids.companyB],[nullable,{...nullable,email:"b@example.test"}])).batches.map(b=>b.companyId)).toEqual([ids.companyA,ids.companyB]);
  const missing=[{...cost,email:null,providerUserId:"missing-a"},{...cost,email:null,providerUserId:"missing-b",amountUsd:"2",amountCents:null}];
  expect((await resolveCostScopes(db,[ids.companyA],missing)).warnings.map(w=>w.providerUserId)).toEqual(["missing-a","missing-b"]);
  expect((await resolveCostScopes(db,[ids.companyA],[{...cost,email:null,providerUserId:"missing-a"},{...cost,email:null,providerUserId:"missing-a"}])).warnings).toHaveLength(1);
});

// Fault: money validation happens only as each row is written, permitting a
// rounded/overflowing later record after the first write attempt. Sequence
// increments survive rollback, so this oracle also catches rolled-back attempts.
test("preserves seeded exact money and rejects invalid batches before any SQL write attempt", async () => {
  await owner.query("CREATE SEQUENCE us071_cost_write_attempts");
  await owner.query("GRANT USAGE ON SEQUENCE us071_cost_write_attempts TO ledger_app");
  await owner.query("CREATE FUNCTION us071_cost_write_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('us071_cost_write_attempts'); RETURN NEW; END $$");
  await owner.query("CREATE TRIGGER us071_cost_write_probe BEFORE INSERT ON cost_record FOR EACH ROW EXECUTE FUNCTION us071_cost_write_probe()");
  try{
    let seed=71071;
    for(let index=0;index<12;index++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const units=BigInt(seed%100000000+1)*(seed%2?1n:-1n);
      const sign=units<0n?"-":"",digits=(units<0n?-units:units).toString().padStart(5,"0");
      const usd=`${sign}${digits.slice(0,-4)}.${digits.slice(-4)}`;
      const cents=`${sign}${digits.slice(0,-2)}.${digits.slice(-2)}`;
      const before=(await owner.query("SELECT last_value,is_called FROM us071_cost_write_attempts")).rows;
      const snapshot=await costRows(),log=await audits();
      await expect(ingestCostBatch(db,{...costBase,records:[cost,{...cost,email:"c@example.test",providerUserId:"c",amountUsd:`${usd}1`,amountCents:null}]})).rejects.toThrow();
      await expect(ingestCostBatch(db,{...costBase,records:[cost,{...cost,email:"c@example.test",providerUserId:"c",amountUsd:usd,amountCents:`${cents}1`}]})).rejects.toThrow();
      expect((await owner.query("SELECT last_value,is_called FROM us071_cost_write_attempts")).rows).toEqual(before);
      expect(await costRows()).toEqual(snapshot);expect(await audits()).toEqual(log);
      const input={...costBase,syncedAt:new Date(costBase.syncedAt.getTime()+index*1000),records:[{...cost,amountUsd:usd,amountCents:cents}]};
      expect((await ingestCostBatch(db,input)).written).toBe(1);
      expect((await costRows())[0]!.amountUsd).toBe(usd);
      expect((await costRows())[0]!.rawPayload).toMatchObject({amountCents:cents,amountUsd:usd.replace(/0+$/,"").replace(/\.$/,"")});
    }
  }finally{
    await owner.query("DROP TRIGGER us071_cost_write_probe ON cost_record");
    await owner.query("DROP FUNCTION us071_cost_write_probe()");
    await owner.query("DROP SEQUENCE us071_cost_write_attempts");
  }
});
