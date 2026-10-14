import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, sql, getTableName } from "drizzle-orm";
import type { ConnectorMemberRecord } from "@smp/connectors";
import type { MemberObservationInput, MemberObservationConsumer } from "./index";
let acceptMemberObservation: typeof import("./index")["acceptMemberObservation"];
import * as schema from "./schema";
import { createAnthropicConnectorObservationBridge } from "@smp/connectors/providers/anthropic/observation";
import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
import { createConnectorCallObservationAppender } from "./connector-call-observations";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { createPostgresFixture, type PostgresFixture } from "./testing/postgres-container";

let fixture: PostgresFixture;
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const actor = "00000000-0000-0000-0000-000000000001";
const accountId = "00000000-0000-0000-0000-000000000083";
const licenseId = "00000000-0000-0000-0000-000000000085";
const A="00000000-0000-0000-0000-00000000a183", B="00000000-0000-0000-0000-000000000184";
const L="00000000-0000-0000-0000-000000000185",ADMIN="00000000-0000-0000-0000-000000000186",FINANCE="00000000-0000-0000-0000-000000000187";
const now = new Date("2026-10-11T00:00:00Z");

beforeAll(async () => {
  fixture = await createPostgresFixture(); await fixture.migrate();
  pool = new pg.Pool({connectionString:fixture.appUrl}); db=drizzle(pool,{schema});
  await db.insert(schema.vendor).values({id:A,name:"Observation provider",connectorType:"api",provisioningProtocol:"rest",
    canProvision:true,canDeprovision:true,hasUsageData:true,hasCostData:true,identityMatching:"email",status:"active",
    createdAt:now,createdBy:actor,memberSeatEvidence:"all_members_licensed",memberLicenseIdentity:"none"});
  await db.insert(schema.licenseType).values({id:L,vendorId:A,name:"Seat",unit:"seat",status:"active",createdAt:now,createdBy:actor});
  await db.insert(schema.userAccount).values([{id:ADMIN,email:"admin@example.test",globalRole:"group_admin",status:"active",createdAt:now},
    {id:FINANCE,email:"finance@example.test",globalRole:"central_finance",status:"active",createdAt:now}]);
  for (const id of [A,B]) await db.insert(schema.vendorAccount).values({id,vendorId:A,name:id,mode:"automated",lowPoolFloor:0,
    status:"active",createdAt:now,createdBy:actor,ingestionMode:"api",defaultLicenseTypeId:L});
},150_000);
afterAll(async () => { await pool?.end(); await fixture?.stop(); });

test("US-083 real catalog mapping and observation contract roundtrip", async () => {
  const [vendor] = await db.insert(schema.vendor).values({id:accountId,name:"Anthropic",connectorType:"api",
    provisioningProtocol:"rest",canProvision:true,canDeprovision:true,hasUsageData:true,hasCostData:true,
    identityMatching:"email",status:"active",createdAt:now,createdBy:actor}).returning();
  expect([vendor!.memberSeatEvidence,vendor!.memberLicenseIdentity]).toEqual(["all_members_licensed","none"]);
  const [license] = await db.insert(schema.licenseType).values({id:licenseId,vendorId:accountId,name:"Claude",
    unit:"seat",status:"active",createdAt:now,createdBy:actor,providerRef:"plan-1"}).returning();
  expect(license!.providerRef).toBe("plan-1");
  const [account] = await db.insert(schema.vendorAccount).values({id:accountId,vendorId:accountId,name:"API fixture",
    mode:"automated",lowPoolFloor:0,status:"active",createdAt:now,createdBy:actor,
    ingestionMode:"api",defaultLicenseTypeId:licenseId}).returning();
  expect(account!.defaultLicenseTypeId).toBe(licenseId);
  const [accepted] = await db.insert(schema.memberObservation).values({vendorAccountId:accountId,source:"api",
    observedAt:now,contentHash:"a".repeat(64),memberCount:0,licensedCount:0,invitedCount:0,acceptedAt:now}).returning();
  expect({account:accepted!.vendorAccountId,source:accepted!.source,time:accepted!.observedAt.toISOString(),
    hash:accepted!.contentHash,counts:[accepted!.memberCount,accepted!.licensedCount,accepted!.invitedCount],
    warnings:accepted!.warnings,correlation:accepted!.correlationId,actor:accepted!.acceptedBy})
    .toEqual({account:accountId,source:"api",time:now.toISOString(),hash:"a".repeat(64),counts:[0,0,0],warnings:[],correlation:null,actor:null});
});


beforeEach(async () => {
  // Load the real public service after runner setup/beforeAll hooks have activated.
  // This also exposes module-initialized helpers to the ordinary mutation run.
  ({acceptMemberObservation}=await import("./index"));
  const owner=await fixture.connectAsOwner();
  try {
    await owner.query("TRUNCATE member_observation,audit_log,connector_call_observation");
    await owner.query("UPDATE vendor_account SET ingestion_mode='api',status='active',default_license_type_id=$1,name=id::text WHERE id IN ($2,$3)",[L,A,B]);
    await owner.query("UPDATE vendor SET member_seat_evidence='all_members_licensed',member_license_identity='none',status='active' WHERE id=$1",[A]);
    await owner.query("UPDATE user_account SET status='active' WHERE id=$1",[ADMIN]);
    await owner.query("UPDATE license_type SET status='active',provider_ref=NULL WHERE id=$1",[L]);
  } finally {await owner.end();}
});
const member=(overrides:Partial<ConnectorMemberRecord>={}):ConnectorMemberRecord=>({provider_member_ref:"u1",email:"USER@example.test",
  display_name:"User",membership_status:"member",reported_role:"admin",seat_evidence:"licensed",
  seat_evidence_provenance:"capability:all_members_licensed",provider_license_ref:null,...overrides});
const options={now:()=>new Date("2026-10-11T03:00:00Z")};
const evidence={member_seat_evidence:"all_members_licensed",member_license_identity:"none"} as const;
const snapshots=()=>db.select().from(schema.memberObservation);
const audits=()=>db.select().from(schema.auditLog).orderBy(schema.auditLog.occurredAt,schema.auditLog.id);
// Hand-serialized normalized fixture, independently SHA-256 checked outside the service.
const singleHash="0cea4e1bb8b7a33a0aa22b0d77dca5468898912dc93c9f3d3e707b17664a1f77";
const emptyHash="4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const deterministicOptions=()=>{let id=600;return {...options,createId:()=>`bbbbbbbb-0000-0000-0000-${String(id++).padStart(12,"0")}`};};
const receiptAudit=(id:string,action:string,after:unknown,actorUserId:string|null=null)=>({id,actorUserId,action,
  entityType:"VendorAccount",entityId:A,companyId:null,note:null,before:null,after,occurredAt:options.now()});
let receiptSequence=300;
async function apiInput(members:readonly ConnectorMemberRecord[]=[member()],account=A,time=now,method="GET",endpointClasses:Partial<Record<"members"|"invitations",string>>={}):Promise<MemberObservationInput> {
  const pages=[];
  for (const stream of ["members","invitations"] as const) {
    const correlationId=`aaaaaaaa-0000-0000-0000-${String(receiptSequence++).padStart(12,"0")}`;
    for (const phase of ["requested","succeeded"] as const) await db.insert(schema.connectorCallObservation).values({vendorAccountId:account,
      correlationId,operation:"sync_members",attempt:1,phase,classification:phase==='requested'?null:'success',
      summary:{endpoint_class:endpointClasses[stream]??stream,method},occurredAt:time});
    pages.push({correlationId,terminalAttempt:1,stream,recordCount:members.filter(m=>m.membership_status===(stream==='members'?'member':'invited')).length});
  }
  return {vendorAccountId:account,source:"api",observedAt:time,members,evidence,actorUserAccountId:null,
    completeness:{kind:"api",pages,exhausted:["members","invitations"]}};
}

test("accepts lossless evidence with separate durable warnings and no register mutation",async()=>{
  const records=[member({email:"  USER@example.test \t"}),member({provider_member_ref:"u2",email:null}),member({provider_member_ref:"i1",email:"invite@example.test",membership_status:"invited",seat_evidence:"unlicensed",seat_evidence_provenance:null})];
  const result=await acceptMemberObservation(db,await apiInput(records),[],options);
  expect(result.status).toBe("accepted");
  const [row]=await snapshots();
  expect([row!.memberCount,row!.licensedCount,row!.invitedCount,row!.warnings]).toEqual([2,2,1,[{kind:"null_email",provider_member_ref:"u2",email:null,detail:"Missing member email"}]]);
  if(result.status==='accepted') expect(result.members.map(m=>[m.provider_member_ref,m.email,m.license_type_id])).toEqual([["u1","user@example.test",L],["u2",null,L],["i1","invite@example.test",null]]);
  expect(await db.select().from(schema.person)).toEqual([]); expect(await db.select().from(schema.licenseAssignment)).toEqual([]);
  expect((await audits()).map(a=>[a.action,a.entityType,a.companyId])).toEqual([["member_observation_accepted","VendorAccount",null]]);
});

test("canonical multiset hash replays across arrival order/source without consumers",async()=>{
  const input=await apiInput([member(),member({provider_member_ref:"u2",email:"second@example.test"})]);
  const first=await acceptMemberObservation(db,input,[],options);
  const replay=await acceptMemberObservation(db,{...input,source:"csv_import",actorUserAccountId:ADMIN,members:[...input.members].reverse(),
    completeness:{kind:"csv_import",complete:true,accountWide:true,recordCount:2}},[async tx=>{await tx.execute(sql`SELECT 1/0`);}],options);
  expect([first.status,replay.status]).toEqual(["accepted","replayed"]);
  // Independently hand-serialized two-record fixture (not the service canonicalizer).
  expect((await snapshots())[0]!.contentHash).toBe("ce4a1093eb141ec3fde54f9438f908bec1ec485d11646e4adff0cc2dad6be181");
  expect(await snapshots()).toHaveLength(1);expect(await audits()).toHaveLength(1);
});

test("empty newer observation blocks stale reopen and immutable equal-time conflict",async()=>{
  const empty=await apiInput([],A,new Date("2026-10-11T02:00:00Z"));
  const ids=deterministicOptions();
  expect((await acceptMemberObservation(db,empty,[],ids)).status).toBe("accepted");
  expect((await acceptMemberObservation(db,await apiInput(),[],ids)).status).toBe("stale");
  expect((await acceptMemberObservation(db,await apiInput([member()],A,empty.observedAt),[],ids)).status).toBe("conflict");
  expect((await snapshots()).map(r=>[r.memberCount,r.licensedCount,r.invitedCount,r.contentHash,r.warnings])).toEqual([[0,0,0,emptyHash,[]]]);
  if(empty.completeness.kind!=="api")throw new Error("receipt");
  expect(await audits()).toEqual([
    receiptAudit("bbbbbbbb-0000-0000-0000-000000000601","member_observation_accepted",{
      vendor_account_id:A,observation_id:"bbbbbbbb-0000-0000-0000-000000000600",content_hash:emptyHash,source:"api",pages:empty.completeness.pages}),
    receiptAudit("bbbbbbbb-0000-0000-0000-000000000602","member_observation_stale",{
      vendor_account_id:A,observed_at:now.toISOString(),latest_observation_id:"bbbbbbbb-0000-0000-0000-000000000600"}),
    receiptAudit("bbbbbbbb-0000-0000-0000-000000000603","member_observation_conflict",{
      vendor_account_id:A,observed_at:empty.observedAt.toISOString(),content_hash:singleHash,
      latest_observation_id:"bbbbbbbb-0000-0000-0000-000000000600",warning:{kind:"member_observation_conflict"}}),
  ]);
});

test("rejects incomplete, wrong-account, duplicated and failed journal evidence",async()=>{
  const input=await apiInput(); if(input.completeness.kind!=='api')throw new Error('receipt');
  const receipt=input.completeness;
  for(const completeness of [{...receipt,exhausted:["members"]},{...receipt,pages:[]},{...receipt,pages:[receipt.pages[0]!,receipt.pages[0]!,receipt.pages[1]!]},{...receipt,providerTotals:{members:99}},
    {...receipt,pages:[{...receipt.pages[0]!,terminalAttempt:2},receipt.pages[1]!]}]) {
    expect((await acceptMemberObservation(db,{...input,completeness} as MemberObservationInput,[],options)).status).toBe("incomplete");
  }
  expect((await acceptMemberObservation(db,{...input,members:[...input.members,...input.members],completeness:{...receipt,pages:[receipt.pages[0]!,{...receipt.pages[0]!,correlationId:receipt.pages[0]!.correlationId.toUpperCase()},receipt.pages[1]!]}},[],options)).status).toBe("incomplete");
  expect((await acceptMemberObservation(db,{...input,vendorAccountId:B},[],options)).status).toBe("incomplete");
  expect(await snapshots()).toEqual([]);
});

test("capability and source authority cannot be promoted by caller evidence",async()=>{
  const input=await apiInput();
  await db.update(schema.vendor).set({memberSeatEvidence:"none"}).where(eq(schema.vendor.id,A));
  expect((await acceptMemberObservation(db,input,[],options)).status).toBe("incomplete");
  const result=await acceptMemberObservation(db,{...input,evidence:{member_seat_evidence:"none",member_license_identity:"none"}},[],options);
  expect(result.status).toBe("accepted");expect((await snapshots())[0]!.licensedCount).toBe(0);
  expect((await snapshots())[0]!.warnings).toEqual([{kind:"unknown_seat_evidence",provider_member_ref:"u1",email:"user@example.test",detail:"Seat evidence is not established by the vendor capability"}]);
  await db.update(schema.vendorAccount).set({ingestionMode:"manual"}).where(eq(schema.vendorAccount.id,B));
  expect((await acceptMemberObservation(db,await apiInput([member()],B),[],options)).status).toBe("forbidden");
});

test("import authority is server-resolved and API cannot impersonate a human",async()=>{
  const input=await apiInput();const completeness={kind:"manual",complete:true,accountWide:true,recordCount:1} as const;
  for(const actorUserAccountId of [null,FINANCE,"00000000-0000-0000-0000-000000999999"]) expect((await acceptMemberObservation(db,{...input,source:"manual",completeness,actorUserAccountId},[],options)).status).toBe("forbidden");
  expect((await acceptMemberObservation(db,{...input,actorUserAccountId:ADMIN},[],options)).status).toBe("forbidden");
  await db.update(schema.userAccount).set({status:"disabled"}).where(eq(schema.userAccount.id,ADMIN));
  expect((await acceptMemberObservation(db,{...input,source:"manual",completeness,actorUserAccountId:ADMIN},[],options)).status).toBe("forbidden");
  expect(await snapshots()).toEqual([]);
});

test("ordered transactional consumers rollback the receipt/audit and prior effect before retry",async()=>{
  const input=await apiInput();if(input.completeness.kind!=="api")throw new Error("receipt");
  const expectedObservation={id:"bbbbbbbb-0000-0000-0000-000000000600",vendorAccountId:A,source:"api",observedAt:now,
    contentHash:singleHash,memberCount:1,licensedCount:1,invitedCount:0,warnings:[],correlationId:input.completeness.pages[0]!.correlationId,
    acceptedAt:options.now(),acceptedBy:null};
  const expectedEvent={type:"member_observation_accepted",observation:expectedObservation,
    members:[{provider_member_ref:"u1",email:"user@example.test",display_name:"User",membership_status:"member",reported_role:"admin",
      seat_evidence:"licensed",seat_evidence_provenance:"capability:all_members_licensed",provider_license_ref:null,license_type_id:L}],warnings:[]};
  const write:MemberObservationConsumer=async(tx,event)=>{
    expect(event).toEqual(expectedEvent);
    expect(await tx.select().from(schema.memberObservation)).toEqual([expectedObservation]);
    expect(await tx.select().from(schema.auditLog)).toEqual([receiptAudit("bbbbbbbb-0000-0000-0000-000000000601",
      "member_observation_accepted",{vendor_account_id:A,observation_id:expectedObservation.id,content_hash:singleHash,source:"api",pages:input.completeness.kind==='api'?input.completeness.pages:[]})]);
    await tx.update(schema.vendorAccount).set({name:"consumer wrote"}).where(eq(schema.vendorAccount.id,A));
  };
  const later:MemberObservationConsumer=async(tx,event)=>{
    expect(event).toEqual(expectedEvent);
    const [account]=await tx.select().from(schema.vendorAccount).where(eq(schema.vendorAccount.id,A));
    expect(account!.name).toBe("consumer wrote");
  };
  await expect(acceptMemberObservation(db,input,[write,async (tx,event)=>{await later(tx,event);
    await tx.insert(schema.memberObservation).values({...event.observation,id:"00000000-0000-0000-0000-000000000199"});}],deterministicOptions()))
    .rejects.toMatchObject({code:"23505",constraint:"uq_member_observation_account_observed"});
  expect(await snapshots()).toEqual([]); expect(await audits()).toEqual([]);
  expect((await db.select().from(schema.vendorAccount).where(eq(schema.vendorAccount.id,A)))[0]!.name).toBe(A);
  expect((await acceptMemberObservation(db,input,[write,later],deterministicOptions())).status).toBe("accepted");
  expect(await snapshots()).toEqual([expectedObservation]);
  expect((await audits()).map(row=>row.id)).toEqual(["bbbbbbbb-0000-0000-0000-000000000601"]);
  expect((await db.select().from(schema.vendorAccount).where(eq(schema.vendorAccount.id,B)))[0]!.name).toBe(B);
});

test("account lock serializes identical and contradictory observations without crossing accounts",async()=>{
  const input=await apiInput();
  expect((await Promise.all([acceptMemberObservation(db,input,[],options),acceptMemberObservation(db,{...input,vendorAccountId:A.toUpperCase()},[],options)])).map(r=>r.status).sort()).toEqual(["accepted","replayed"]);
  expect((await snapshots()).map(row=>row.vendorAccountId)).toEqual([A]);
  const different=await apiInput([member({reported_role:"user"})]);
  expect((await acceptMemberObservation(db,different,[],options)).status).toBe("conflict");
  expect((await acceptMemberObservation(db,await apiInput([],B),[],options)).status).toBe("accepted");
  expect((await snapshots()).map(r=>r.vendorAccountId).sort()).toEqual([A,B].sort());
});


test("US-083 ORM declarations preserve the canonical accepted-evidence physical contract",async()=>{
  const dialect=new PgDialect();const observation=getTableConfig(schema.memberObservation);
  expect(observation.name).toBe("member_observation");
  expect(observation.columns.map(column=>[column.name,column.getSQLType(),column.notNull,column.primary,column.hasDefault])).toEqual([
    ["id","uuid",true,true,true],["vendor_account_id","uuid",true,false,false],["source","ingestion_source",true,false,false],
    ["observed_at","timestamp with time zone",true,false,false],["content_hash","text",true,false,false],
    ["member_count","integer",true,false,false],["licensed_count","integer",true,false,false],["invited_count","integer",true,false,false],
    ["warnings","jsonb",true,false,true],["correlation_id","uuid",false,false,false],
    ["accepted_at","timestamp with time zone",true,false,false],["accepted_by","uuid",false,false,false],
  ]);
  expect(schema.memberObservation.warnings.default).toEqual([]);
  expect(observation.foreignKeys.map(key=>{const ref=key.reference();return [ref.columns.map(c=>c.name),getTableName(ref.foreignTable),ref.foreignColumns.map(c=>c.name)];})).toEqual([
    [["vendor_account_id"],"vendor_account",["id"]],[["accepted_by"],"user_account",["id"]],
  ]);
  expect(observation.uniqueConstraints.map(key=>[key.name,key.columns.map(c=>c.name)])).toEqual([["uq_member_observation_account_observed",["vendor_account_id","observed_at"]]]);
  expect(observation.checks.map(check=>[check.name,dialect.sqlToQuery(check.value).sql])).toEqual([
    ["member_observation_counts_check",'"member_observation"."member_count" >= 0 AND "member_observation"."licensed_count" >= 0 AND "member_observation"."invited_count" >= 0 AND "member_observation"."licensed_count" <= "member_observation"."member_count"'],
    ["member_observation_hash_check",`"member_observation"."content_hash" ~ '^[0-9a-f]{64}$'`],
    ["member_observation_warnings_check",`jsonb_typeof("member_observation"."warnings") = 'array'`],
  ]);
  expect(observation.indexes.map(index=>[index.config.name,index.config.columns.map(column=>"name" in column?column.name:null)])).toEqual([["idx_member_observation_correlation",["correlation_id"]]]);
  expect([schema.vendor.memberSeatEvidence.enumValues,schema.vendor.memberLicenseIdentity.enumValues]).toEqual([
    ["provider_field","all_members_licensed","none"],["provider_field","none"],
  ]);
  expect([schema.vendor.memberSeatEvidence.getSQLType(),schema.vendor.memberLicenseIdentity.getSQLType(),schema.vendor.memberSeatEvidence.name,schema.vendor.memberSeatEvidence.default,schema.vendor.memberSeatEvidence.notNull,
    schema.vendor.memberLicenseIdentity.name,schema.vendor.memberLicenseIdentity.default,schema.vendor.memberLicenseIdentity.notNull]).toEqual([
    "vendor_member_seat_evidence_enum","vendor_member_license_identity_enum","member_seat_evidence","none",true,"member_license_identity","none",true,
  ]);
  const account=getTableConfig(schema.vendorAccount);const defaultKey=account.foreignKeys.find(key=>key.reference().columns[0]===schema.vendorAccount.defaultLicenseTypeId)!;
  expect([schema.vendorAccount.defaultLicenseTypeId.name,getTableName(defaultKey.reference().foreignTable),defaultKey.reference().foreignColumns.map(c=>c.name)]).toEqual(["default_license_type_id","license_type",["id"]]);
  expect(getTableConfig(schema.licenseType).uniqueConstraints.map(key=>[key.name,key.columns.map(c=>c.name)])).toEqual([["uq_license_type_vendor_provider_ref",["vendor_id","provider_ref"]]]);
  const physical=await pool.query(`SELECT attname AS name,format_type(atttypid,atttypmod) AS type,attnotnull AS required
    FROM pg_attribute WHERE attrelid='member_observation'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`);
  expect(observation.columns.map(column=>({name:column.name,type:column.getSQLType(),required:column.notNull}))).toEqual(physical.rows);
  const enums=await pool.query(`SELECT typname,array_agg(enumlabel ORDER BY enumsortorder)::text[] AS values FROM pg_type
    JOIN pg_enum ON enumtypid=pg_type.oid WHERE typname IN ('vendor_member_seat_evidence_enum','vendor_member_license_identity_enum') GROUP BY typname ORDER BY typname`);
  expect([{typname:schema.vendor.memberLicenseIdentity.getSQLType(),values:schema.vendor.memberLicenseIdentity.enumValues},
    {typname:schema.vendor.memberSeatEvidence.getSQLType(),values:schema.vendor.memberSeatEvidence.enumValues}]).toEqual(enums.rows);
  const defaults=await pool.query(`SELECT column_name,column_default FROM information_schema.columns
    WHERE table_name='vendor' AND column_name IN ('member_license_identity','member_seat_evidence') ORDER BY column_name`);
  expect([schema.vendor.memberLicenseIdentity,schema.vendor.memberSeatEvidence].map(column=>({column_name:column.name,column_default:`'${column.default}'::${column.getSQLType()}`}))).toEqual(defaults.rows);
  const unknown=await db.insert(schema.vendor).values({name:"No capability provider",connectorType:"manual",provisioningProtocol:"none",
    canProvision:false,canDeprovision:false,hasUsageData:false,hasCostData:false,identityMatching:"email",status:"active",createdAt:now,createdBy:actor}).returning();
  expect([unknown[0]!.memberSeatEvidence,unknown[0]!.memberLicenseIdentity]).toEqual(["none","none"]);

});


test("provider-field mapping is vendor-scoped and unknown references remain durable warnings",async()=>{
  await db.update(schema.vendor).set({memberSeatEvidence:"provider_field",memberLicenseIdentity:"provider_field"}).where(eq(schema.vendor.id,A));
  await db.update(schema.licenseType).set({providerRef:"PLAN"}).where(eq(schema.licenseType.id,L));
  const records=[member({provider_license_ref:"PLAN",seat_evidence_provenance:"provider_field:seat"}),
    member({provider_member_ref:"u2",email:"other@example.test",provider_license_ref:"plan",seat_evidence_provenance:"provider_field:seat"}),
    member({provider_member_ref:"u3",email:"third@example.test",provider_license_ref:"PLAN",seat_evidence_provenance:null})];
  const input=await apiInput(records);const result=await acceptMemberObservation(db,{...input,evidence:{member_seat_evidence:"provider_field",member_license_identity:"provider_field"}},[],options);
  expect(result.status).toBe("accepted");
  if(result.status==='accepted')expect(result.members.map(r=>[r.seat_evidence,r.license_type_id])).toEqual([["licensed",L],["licensed",null],["unknown",null]]);
  expect((await snapshots()).map(row=>[row.memberCount,row.licensedCount,row.invitedCount])).toEqual([[3,1,0]]);
  expect((await snapshots())[0]!.warnings).toEqual([
    {kind:"unmapped_license",provider_member_ref:"u2",email:"other@example.test",detail:"No unique active vendor license mapping"},
    {kind:"unknown_seat_evidence",provider_member_ref:"u3",email:"third@example.test",detail:"Seat evidence is not established by the vendor capability"},
  ]);
});

test("cross-vendor default cannot establish a license and repeated identity is preserved with warnings",async()=>{
  const otherVendor="00000000-0000-0000-0000-000000000288",otherLicense="00000000-0000-0000-0000-000000000289";
  await db.insert(schema.vendor).values({id:otherVendor,name:"Cross-vendor fixture",connectorType:"manual",provisioningProtocol:"none",
    canProvision:false,canDeprovision:false,hasUsageData:false,hasCostData:false,identityMatching:"email",status:"active",createdAt:now,createdBy:actor});
  await db.insert(schema.licenseType).values({id:otherLicense,vendorId:otherVendor,name:"Other seat",unit:"seat",status:"active",createdAt:now,createdBy:actor});
  await db.update(schema.vendorAccount).set({defaultLicenseTypeId:otherLicense}).where(eq(schema.vendorAccount.id,A));
  const result=await acceptMemberObservation(db,await apiInput([member(),member({provider_member_ref:"u2"})]),[],options);
  expect(result.status).toBe("accepted");
  if(result.status==='accepted')expect(result.members.map(r=>[r.provider_member_ref,r.license_type_id])).toEqual([["u1",null],["u2",null]]);
  expect((await snapshots())[0]!.warnings).toEqual([
    {kind:"ambiguous_identity",provider_member_ref:"u1",email:"user@example.test",detail:"Member identity appears more than once"},
    {kind:"unmapped_license",provider_member_ref:"u1",email:"user@example.test",detail:"No unique active vendor license mapping"},
    {kind:"ambiguous_identity",provider_member_ref:"u2",email:"user@example.test",detail:"Member identity appears more than once"},
    {kind:"unmapped_license",provider_member_ref:"u2",email:"user@example.test",detail:"No unique active vendor license mapping"},
  ]);
  expect((await snapshots())[0]!.licensedCount).toBe(0);
});

test("successful retry receipt is accepted but failed/unpaired/wrong-operation evidence is rejected",async()=>{
  const input=await apiInput();if(input.completeness.kind!=='api')throw new Error('receipt');
  const add=async(id:string,operation:"sync_members"|"sync_activity",attempt:number,phase:"requested"|"succeeded"|"failed")=>{
    await db.insert(schema.connectorCallObservation).values({vendorAccountId:A,correlationId:id,operation,attempt,phase,
      classification:phase==='requested'?null:phase==='succeeded'?'success':'provider_error',summary:{endpoint_class:'members',method:'GET'},occurredAt:now});
  };
  const retry="00000000-0000-0000-0000-000000000290";
  await add(retry,'sync_members',1,'requested');await add(retry,'sync_members',1,'failed');
  await add(retry,'sync_members',2,'requested');await add(retry,'sync_members',2,'succeeded');
  const pages=[{...input.completeness.pages[0]!,correlationId:retry,terminalAttempt:2},input.completeness.pages[1]!];
  expect((await acceptMemberObservation(db,{...input,completeness:{...input.completeness,pages}},[],options)).status).toBe('accepted');
  for(const [id,operation,terminal]of [
    ["00000000-0000-0000-0000-000000000291",'sync_members','failed'],
    ["00000000-0000-0000-0000-000000000292",'sync_members',null],
    ["00000000-0000-0000-0000-000000000293",'sync_activity','succeeded'],
  ]as const){
    await add(id,operation,1,'requested');if(terminal)await add(id,operation,1,terminal);
    expect((await acceptMemberObservation(db,{...input,completeness:{...input.completeness,pages:[{...pages[0]!,correlationId:id,terminalAttempt:1},pages[1]!]}},[],options)).status).toBe('incomplete');
  }
});

test("receipt shape, parsing completion and inactive catalog fail closed without consumers",async()=>{
  const input=await apiInput();
  for(const completeness of [null,{kind:'manual',complete:false,accountWide:true,recordCount:1},{kind:'manual',complete:true,accountWide:false,recordCount:1},
    {kind:'manual',complete:true,accountWide:true,recordCount:2}] )expect((await acceptMemberObservation(db,{...input,source:'manual',actorUserAccountId:ADMIN,completeness}as MemberObservationInput,[],options)).status).toBe('incomplete');
  expect((await acceptMemberObservation(db,{...input,observedAt:new Date('invalid')},[],options)).status).toBe('incomplete');
  await db.update(schema.vendorAccount).set({status:'inactive'}).where(eq(schema.vendorAccount.id,A));
  expect((await acceptMemberObservation(db,input,[],options)).status).toBe('forbidden');
  expect(await snapshots()).toEqual([]);
});


test("production Anthropic observation bridge produces accepted neutral journal receipts",async()=>{
  const journal=createConnectorCallObservationAppender(fixture.appUrl);
  const pages=[];
  try{
    for(const [stream,endpoint,count]of [['members','members',1],['invitations','invites',0]]as const){
      const correlationId=`00000000-0000-0000-0000-${String(receiptSequence++).padStart(12,'0')}`;
      const session=createConnectorCallObservationSession({vendorAccountId:A,operation:'sync_members',append:journal.append,
        clock:()=>now,randomId:()=>correlationId,provisioningActionId:null});
      const bridge=createAnthropicConnectorObservationBridge(session);
      await bridge({endpoint,method:'GET',attempt:1,phase:'requested',observedAt:now.getTime(),status:null,classification:null});
      await bridge({endpoint,method:'GET',attempt:1,phase:'completed',observedAt:now.getTime(),status:200,classification:'success'});
      pages.push({correlationId,terminalAttempt:1,stream,recordCount:count});
    }
    expect((await acceptMemberObservation(db,{vendorAccountId:A,source:'api',observedAt:now,members:[member()],evidence,actorUserAccountId:null,
      completeness:{kind:'api',pages,exhausted:['members','invitations']}},[],options)).status).toBe('accepted');
    expect((await db.select().from(schema.connectorCallObservation)).map(row=>(row.summary as {endpoint_class:string}).endpoint_class).sort()).toEqual(['invitations','invitations','members','members']);
  }finally{await journal.close();}
});


test("real journal enforces exact page counts, totals, stream order and GET method",async()=>{
  const input=await apiInput([member(),member({provider_member_ref:"i1",email:"invite@example.test",membership_status:"invited",seat_evidence:"unlicensed",seat_evidence_provenance:null})]);
  if(input.completeness.kind!=="api")throw new Error("receipt");
  const receipt=input.completeness;
  for(const completeness of [
    {...receipt,pages:[{...receipt.pages[0]!,recordCount:0},receipt.pages[1]!] },
    {...receipt,pages:[receipt.pages[0]!,{...receipt.pages[1]!,recordCount:0}] },
    {...receipt,pages:[...receipt.pages].reverse()},
    {...receipt,providerTotals:{members:1,invitations:2}},
    {...receipt,providerTotals:{members:1,invitations:-1}},
    {...receipt,providerTotals:{members:1,invitations:0}},
    {...receipt,providerTotals:{unknown:0}},
  ]) expect(await acceptMemberObservation(db,{...input,completeness} as MemberObservationInput,[],options)).toEqual({status:"incomplete"});
  expect(await acceptMemberObservation(db,await apiInput(input.members,A,now,"POST"),[],options)).toEqual({status:"incomplete"});
  expect(await snapshots()).toEqual([]);expect(await audits()).toEqual([]);
  expect((await acceptMemberObservation(db,{...input,completeness:{...receipt,providerTotals:{members:1,invitations:1}}},[],options)).status).toBe("accepted");
  expect((await snapshots()).map(row=>[row.memberCount,row.invitedCount])).toEqual([[1,1]]);
});

test("inactive vendor and persisted license-identity capability mismatch reject before consumers",async()=>{
  const input=await apiInput();
  const forbiddenConsumer:MemberObservationConsumer=async(tx)=>{await tx.update(schema.vendorAccount).set({name:"rejected consumer"}).where(eq(schema.vendorAccount.id,A));};
  await db.update(schema.vendor).set({status:"inactive"}).where(eq(schema.vendor.id,A));
  expect(await acceptMemberObservation(db,input,[forbiddenConsumer],options)).toEqual({status:"forbidden"});
  await db.update(schema.vendor).set({status:"active",memberLicenseIdentity:"provider_field"}).where(eq(schema.vendor.id,A));
  expect(await acceptMemberObservation(db,input,[forbiddenConsumer],options)).toEqual({status:"incomplete"});
  expect(await snapshots()).toEqual([]);expect(await audits()).toEqual([]);
  expect((await db.select().from(schema.vendorAccount).where(eq(schema.vendorAccount.id,A)))[0]!.name).toBe(A);
  expect((await db.select().from(schema.vendorAccount).where(eq(schema.vendorAccount.id,B)))[0]!.name).toBe(B);
});

test("duplicate provider identity warns for different normalized emails without dropping records",async()=>{
  const input=await apiInput([member({email:"  FIRST@example.test \t"}),member({email:" SECOND@example.test ",display_name:"Second"})]);
  const result=await acceptMemberObservation(db,input,[],options);
  expect(result.status).toBe("accepted");
  if(result.status!=="accepted")throw new Error("accepted fixture");
  const warnings=[
    {kind:"ambiguous_identity",provider_member_ref:"u1",email:"first@example.test",detail:"Member identity appears more than once"},
    {kind:"ambiguous_identity",provider_member_ref:"u1",email:"second@example.test",detail:"Member identity appears more than once"},
  ];
  expect(result.members.map(record=>[record.provider_member_ref,record.email,record.license_type_id])).toEqual([["u1","first@example.test",L],["u1","second@example.test",L]]);
  expect(result.warnings).toEqual(warnings);
  expect((await snapshots()).map(row=>[row.memberCount,row.licensedCount,row.invitedCount,row.warnings])).toEqual([[2,2,0,warnings]]);
  expect(await db.select().from(schema.person)).toEqual([]);expect(await db.select().from(schema.licenseAssignment)).toEqual([]);
  expect((await snapshots()).map(row=>row.vendorAccountId)).toEqual([A]);
});

test("newer identical content is accepted while equal-time replay creates no consumer effect",async()=>{
  const input=await apiInput();
  const first=await acceptMemberObservation(db,input,[],deterministicOptions());
  const newer=await apiInput([member()],A,new Date("2026-10-11T01:00:00Z"));
  const accepted=await acceptMemberObservation(db,newer,[async(tx,event)=>{expect(event.type).toBe("member_observation_accepted");
    await tx.update(schema.vendorAccount).set({name:"newer accepted"}).where(eq(schema.vendorAccount.id,A));}],options);
  expect([first.status,accepted.status]).toEqual(["accepted","accepted"]);
  expect((await snapshots()).map(row=>[row.observedAt.toISOString(),row.contentHash]).sort()).toEqual([[now.toISOString(),singleHash],[newer.observedAt.toISOString(),singleHash]]);
  expect((await audits()).filter(row=>row.action==="member_observation_accepted")).toHaveLength(2);
  const replay=await acceptMemberObservation(db,newer,[async()=>{throw new Error("Replay reached consumer");}],options);
  expect(replay.status).toBe("replayed");expect(await snapshots()).toHaveLength(2);expect(await audits()).toHaveLength(2);
  expect((await db.select().from(schema.vendorAccount).where(eq(schema.vendorAccount.id,A)))[0]!.name).toBe("newer accepted");
});

test("held account advisory lock blocks acceptance before catalog reads and isolates other accounts",async()=>{
  const input=await apiInput();
  const holder=await fixture.connectAsApp(),waiting=await fixture.connectAsApp();
  let release=false,finished=false;
  try {
    const holderPid=(await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const waitingPid=(await waiting.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1,83083))",[A]);
    const attempt=acceptMemberObservation(drizzle(waiting,{schema}),input,[],options);
    const completed=attempt.then(result=>{finished=true;return {kind:"completed" as const,status:result.status};},error=>{finished=true;throw error;});
    const coordinated=(async()=>{
      while(!finished){
        const row=(await holder.query("SELECT $1::integer = ANY(pg_blocking_pids($2)) AS blocked",[holderPid,waitingPid])).rows[0];
        if(row.blocked)return {kind:"blocked" as const};
      }
      return {kind:"completed" as const};
    })();
    expect(await Promise.race([completed,coordinated])).toEqual({kind:"blocked"});
    expect(await snapshots()).toEqual([]);expect(await audits()).toEqual([]);
    expect((await acceptMemberObservation(db,await apiInput([],B),[],options)).status).toBe("accepted");
    await holder.query("COMMIT");release=true;
    expect((await attempt).status).toBe("accepted");
    expect((await acceptMemberObservation(db,input,[],options)).status).toBe("replayed");
    expect((await snapshots()).map(row=>[row.vendorAccountId,row.memberCount]).sort()).toEqual([[A,1],[B,0]].sort());
    expect((await audits()).map(row=>[row.action,row.entityId]).sort()).toEqual([["member_observation_accepted",A],["member_observation_accepted",B]].sort());
  } finally {
    finished=true;
    if(!release)await holder.query("ROLLBACK");
    await waiting.end();await holder.end();
  }
});


test("complete receipts reject malformed boundaries without effects and accept each complete stream fixture",async()=>{
  const input=await apiInput();if(input.completeness.kind!=="api")throw new Error("receipt");
  const receipt=input.completeness,second=await apiInput();if(second.completeness.kind!=="api")throw new Error("receipt");
  const extra=second.completeness.pages[0]!;
  const incomplete:unknown[]=[
    {kind:"manual",complete:true,accountWide:true,recordCount:1},
    {...receipt,exhausted:["invitations"]},{...receipt,exhausted:[]},
    {...receipt,exhausted:["members","invitations","members"]},
    {...receipt,exhausted:["invitations","invitations"]},
    {...receipt,pages:null},{...receipt,pages:{}},{...receipt,exhausted:{}},
    {...receipt,pages:[null,receipt.pages[1]!]},{...receipt,pages:[42,receipt.pages[1]!]},{...receipt,pages:["page",receipt.pages[1]!]},
    {...receipt,pages:[receipt.pages[0]!] },
    {...receipt,pages:[{...receipt.pages[0]!,recordCount:0.5},{...extra,recordCount:0.5},receipt.pages[1]!] },
    {...receipt,pages:[{...receipt.pages[0]!,recordCount:-1},{...extra,recordCount:2},receipt.pages[1]!] },
    ...[0,-1,0.5,Number.MAX_SAFE_INTEGER+1,"1"].map(terminalAttempt=>({...receipt,pages:[{...receipt.pages[0]!,terminalAttempt},receipt.pages[1]!] })),
    ...["prefix"+receipt.pages[0]!.correlationId,receipt.pages[0]!.correlationId+"suffix",42].map(correlationId=>({...receipt,pages:[{...receipt.pages[0]!,correlationId},receipt.pages[1]!] })),
    ...[null,[],42,"totals",{unexpected:undefined}].map(providerTotals=>({...receipt,providerTotals})),
  ];
  const effect:MemberObservationConsumer=async tx=>{await tx.update(schema.vendorAccount).set({name:"incomplete consumer"}).where(eq(schema.vendorAccount.id,A));};
  for(const completeness of incomplete)expect(await acceptMemberObservation(db,{...input,completeness} as MemberObservationInput,[effect],options)).toEqual({status:"incomplete"});
  for(const endpointClasses of [{members:"invitations"},{invitations:"members"},{members:"unknown"}])
    expect(await acceptMemberObservation(db,await apiInput(input.members,A,now,"GET",endpointClasses),[effect],options)).toEqual({status:"incomplete"});
  expect(await snapshots()).toEqual([]);expect(await audits()).toEqual([]);
  expect((await db.select().from(schema.vendorAccount)).filter(a=>[A,B].includes(a.id)).map(a=>[a.id,a.name]).sort()).toEqual([[A,A],[B,B]].sort());
  const fixtures=[
    {records:[],counts:[0,0,0]},
    {records:[member({provider_member_ref:"invite",email:"invite@example.test",membership_status:"invited",seat_evidence:"licensed",seat_evidence_provenance:"provider_field:seat"})],counts:[0,0,1]},
    {records:[member()],counts:[1,1,0]},
  ];
  for(const [offset,fixtureCase]of fixtures.entries()){
    const valid=await apiInput(fixtureCase.records,A,new Date(now.getTime()+offset*1000));if(valid.completeness.kind!=="api")throw new Error("receipt");
    expect((await acceptMemberObservation(db,{...valid,completeness:{...valid.completeness,providerTotals:{members:fixtureCase.counts[0]!,invitations:fixtureCase.counts[2]!}}},[],options)).status).toBe("accepted");
  }
  expect((await snapshots()).map(row=>[row.memberCount,row.licensedCount,row.invitedCount]).sort()).toEqual(fixtures.map(c=>c.counts).sort());
  expect((await snapshots()).every(row=>row.vendorAccountId===A)).toBe(true);expect(await audits()).toHaveLength(3);
});

test("public malformed inputs and clocks preserve exact rejection semantics without effects",async()=>{
  const input=await apiInput();
  const malformed:unknown[]=[
    ...[42,null,"invalid","prefix"+A,A+"suffix"].map(vendorAccountId=>({...input,vendorAccountId})),
    ...[now.toISOString(),42,null,{getTime:()=>now.getTime()}].map(observedAt=>({...input,observedAt})),
    {...input,source:"other"},{...input,members:null},{...input,members:{}},
    {...input,members:[{...member(),email:"not an email"}]},{...input,members:[{...member(),membership_status:"other"}]},
    {...input,members:[{...member(),seat_evidence:"other"}]},{...input,members:[{provider_member_ref:"only"}]},
    ...[null,{},[],{member_seat_evidence:"other",member_license_identity:"none"},{member_seat_evidence:"all_members_licensed",member_license_identity:"other"}].map(evidence=>({...input,evidence})),
  ];
  const effect:MemberObservationConsumer=async tx=>{await tx.update(schema.vendorAccount).set({name:"invalid consumer"}).where(eq(schema.vendorAccount.id,A));};
  for(const value of malformed)expect(await acceptMemberObservation(db,value as MemberObservationInput,[effect],options)).toEqual({status:"incomplete"});
  for(const actorUserAccountId of ["not-a-uuid","prefix"+ADMIN,ADMIN+"suffix",42])
    expect(await acceptMemberObservation(db,{...input,source:"manual",completeness:{kind:"manual",complete:true,accountWide:true,recordCount:1},actorUserAccountId} as MemberObservationInput,[effect],options)).toEqual({status:"forbidden"});
  for(const value of [new Date("invalid"),42,{getTime:()=>0},{getTime:()=>Number.POSITIVE_INFINITY}]){
    let rejection:unknown;
    try{await acceptMemberObservation(db,input,[effect],{now:()=>value as Date});}catch(error){rejection=error;}
    // Validation throws the ordinary Error class, before a database serializer's TypeError/RangeError.
    expect(rejection).toBeInstanceOf(Error);expect((rejection as Error).constructor).toBe(Error);
  }
  expect(await snapshots()).toEqual([]);expect(await audits()).toEqual([]);
  expect((await db.select().from(schema.vendorAccount)).filter(a=>[A,B].includes(a.id)).map(a=>[a.id,a.name]).sort()).toEqual([[A,A],[B,B]].sort());
});

test("default clock and consumer defaults accept with correlated finite timestamps",async()=>{
  const input=await apiInput();let id=700;
  const result=await acceptMemberObservation(db,input,undefined,{createId:()=>`bbbbbbbb-0000-0000-0000-${String(id++).padStart(12,"0")}`});
  expect(result.status).toBe("accepted");if(result.status!=="accepted")throw new Error("accepted fixture");
  expect(result.observation.acceptedAt).toBeInstanceOf(Date);
  expect(Number.isFinite(result.observation.acceptedAt.getTime())).toBe(true);
  expect((await snapshots())[0]!.acceptedAt).toEqual(result.observation.acceptedAt);
  expect(result.observation.contentHash).toBe(singleHash);
  const [audit]=await audits();expect(audit!.occurredAt).toEqual(result.observation.acceptedAt);
  expect(audit).toEqual({...receiptAudit("bbbbbbbb-0000-0000-0000-000000000701","member_observation_accepted",{
    vendor_account_id:A,observation_id:"bbbbbbbb-0000-0000-0000-000000000700",content_hash:singleHash,source:"api",pages:input.completeness.kind==='api'?input.completeness.pages:[]}),occurredAt:result.observation.acceptedAt});
  expect((await snapshots()).map(row=>row.vendorAccountId)).toEqual([A]);
});

test("effective seat capability keeps contradictory valid records unknown and invitations normalized",async()=>{
  const cases=[
    {capability:"all_members_licensed",records:[member({seat_evidence:"unknown"}),member({provider_member_ref:"u2",email:"two@example.test",seat_evidence:"unlicensed"}),member({provider_member_ref:"u3",email:"three@example.test",seat_evidence_provenance:null}),member({provider_member_ref:"u4",email:"four@example.test",seat_evidence_provenance:"provider_field:seat"})]},
    {capability:"provider_field",records:[member({seat_evidence:"unknown",seat_evidence_provenance:"provider_field:seat"}),member({provider_member_ref:"u2",email:"two@example.test",seat_evidence_provenance:"prefixprovider_field:seat"}),member({provider_member_ref:"u3",email:"three@example.test",seat_evidence_provenance:"provider_field:seat trailing"}),member({provider_member_ref:"u4",email:"four@example.test",seat_evidence_provenance:null})]},
    {capability:"none",records:[member({seat_evidence_provenance:"provider_field:seat"})]},
  ] as const;
  for(const [offset,fixtureCase]of cases.entries()){
    await db.update(schema.vendor).set({memberSeatEvidence:fixtureCase.capability,memberLicenseIdentity:"none"}).where(eq(schema.vendor.id,A));
    const input=await apiInput(fixtureCase.records,A,new Date(now.getTime()+offset*1000));
    const result=await acceptMemberObservation(db,{...input,evidence:{member_seat_evidence:fixtureCase.capability,member_license_identity:"none"}},[],options);
    expect(result.status).toBe("accepted");if(result.status!=="accepted")throw new Error("accepted fixture");
    const warnings=fixtureCase.records.map(record=>({kind:"unknown_seat_evidence",provider_member_ref:record.provider_member_ref,email:record.email!.trim().toLowerCase(),detail:"Seat evidence is not established by the vendor capability"}));
    expect(result.members.map(record=>[record.provider_member_ref,record.seat_evidence,record.license_type_id])).toEqual(fixtureCase.records.map(record=>[record.provider_member_ref,"unknown",null]));
    expect(result.warnings).toEqual(warnings);expect(result.observation.warnings).toEqual(warnings);
    expect([result.observation.memberCount,result.observation.licensedCount,result.observation.invitedCount]).toEqual([fixtureCase.records.length,0,0]);
  }
  await db.update(schema.vendor).set({memberSeatEvidence:"all_members_licensed"}).where(eq(schema.vendor.id,A));
  const invited=[member({provider_member_ref:"i1",email:"i1@example.test",membership_status:"invited",seat_evidence:"licensed",seat_evidence_provenance:"provider_field:seat"}),member({provider_member_ref:"i2",email:"i2@example.test",membership_status:"invited",seat_evidence:"unknown",seat_evidence_provenance:"capability:all_members_licensed"})];
  const result=await acceptMemberObservation(db,await apiInput(invited,A,new Date(now.getTime()+3000)),[],options);
  expect(result.status).toBe("accepted");if(result.status!=="accepted")throw new Error("accepted fixture");
  expect(result.members.map(record=>[record.provider_member_ref,record.seat_evidence,record.seat_evidence_provenance,record.license_type_id])).toEqual([["i1","unlicensed",null,null],["i2","unlicensed",null,null]]);
  expect([result.observation.memberCount,result.observation.licensedCount,result.observation.invitedCount,result.observation.warnings]).toEqual([0,0,2,[]]);
  expect((await snapshots()).every(row=>row.vendorAccountId===A)).toBe(true);
});

test("null provider license identity never maps a NULL declaration and inactive mappings warn",async()=>{
  await db.update(schema.vendor).set({memberSeatEvidence:"provider_field",memberLicenseIdentity:"provider_field"}).where(eq(schema.vendor.id,A));
  const input=await apiInput([member({seat_evidence_provenance:"provider_field:seat",provider_license_ref:null})]);
  const result=await acceptMemberObservation(db,{...input,evidence:{member_seat_evidence:"provider_field",member_license_identity:"provider_field"}},[],options);
  expect(result.status).toBe("accepted");if(result.status!=="accepted")throw new Error("accepted fixture");
  const warning={kind:"unmapped_license",provider_member_ref:"u1",email:"user@example.test",detail:"No unique active vendor license mapping"};
  expect(result.members.map(record=>[record.seat_evidence,record.provider_license_ref,record.license_type_id])).toEqual([["licensed",null,null]]);
  expect([result.observation.memberCount,result.observation.licensedCount,result.observation.warnings]).toEqual([1,0,[warning]]);
  await db.update(schema.licenseType).set({providerRef:"PLAN",status:"inactive"}).where(eq(schema.licenseType.id,L));
  const inactive=await apiInput([member({seat_evidence_provenance:"provider_field:seat",provider_license_ref:"PLAN"})],A,new Date(now.getTime()+1000));
  const rejectedMapping=await acceptMemberObservation(db,{...inactive,evidence:{member_seat_evidence:"provider_field",member_license_identity:"provider_field"}},[],options);
  expect(rejectedMapping.status).toBe("accepted");if(rejectedMapping.status!=="accepted")throw new Error("accepted fixture");
  expect(rejectedMapping.members[0]!.license_type_id).toBeNull();expect(rejectedMapping.observation.warnings).toEqual([warning]);
  expect(rejectedMapping.observation.licensedCount).toBe(0);expect((await snapshots()).every(row=>row.vendorAccountId===A)).toBe(true);
});

test("fresh manual and CSV observations persist exact actor receipts and transactional events",async()=>{
  for(const [offset,source]of (["manual","csv_import"] as const).entries()){
    const time=new Date(now.getTime()+offset*1000);const input:MemberObservationInput={vendorAccountId:A,source,observedAt:time,members:[member()],evidence,actorUserAccountId:ADMIN,
      completeness:{kind:source,complete:true,accountWide:true,recordCount:1}};
    let id=800+offset*2;const observationId=`bbbbbbbb-0000-0000-0000-${String(id).padStart(12,"0")}`,auditId=`bbbbbbbb-0000-0000-0000-${String(id+1).padStart(12,"0")}`;
    const expectedObservation={id:observationId,vendorAccountId:A,source,observedAt:time,contentHash:singleHash,memberCount:1,licensedCount:1,invitedCount:0,
      warnings:[],correlationId:null,acceptedAt:options.now(),acceptedBy:ADMIN};
    const expectedAudit=receiptAudit(auditId,"member_observation_accepted",{vendor_account_id:A,observation_id:observationId,content_hash:singleHash,source,pages:[]},ADMIN);
    const result=await acceptMemberObservation(db,input,[async(tx,event)=>{
      expect(event).toEqual({type:"member_observation_accepted",observation:expectedObservation,members:[{...member(),email:"user@example.test",license_type_id:L}],warnings:[]});
      expect((await tx.select().from(schema.auditLog)).find(row=>row.id===auditId)).toEqual(expectedAudit);
      await tx.update(schema.vendorAccount).set({name:source}).where(eq(schema.vendorAccount.id,A));
    }],{...options,createId:()=>`bbbbbbbb-0000-0000-0000-${String(id++).padStart(12,"0")}`});
    expect(result.status).toBe("accepted");expect((await snapshots()).find(row=>row.id===observationId)).toEqual(expectedObservation);
    expect((await audits()).find(row=>row.id===auditId)).toEqual(expectedAudit);
    expect((await db.select().from(schema.vendorAccount).where(eq(schema.vendorAccount.id,A)))[0]!.name).toBe(source);
    expect((await db.select().from(schema.vendorAccount).where(eq(schema.vendorAccount.id,B)))[0]!.name).toBe(B);
  }
  expect(await snapshots()).toHaveLength(2);expect(await audits()).toHaveLength(2);
});
