import { mkdtempSync,writeFileSync,chmodSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptCredential } from "./credential-crypto";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
const webRequire=createRequire(new URL("../../../apps/web/package.json",import.meta.url));
const {createAnthropicConnector}=await import(webRequire.resolve("@smp/connectors/providers/anthropic/connector")) as {createAnthropicConnector:import("./invitation-withdrawal").InvitationWithdrawalConnectorFactory};
const {createAnthropicRateLimiter}=await import(webRequire.resolve("@smp/connectors/providers/anthropic/rate-limiter")) as {createAnthropicRateLimiter:import("./invitation-withdrawal").InvitationWithdrawalLimiterFactory};
const {assertLegalTransition}=await import(webRequire.resolve("@smp/domain/request-workflow")) as {assertLegalTransition:(from:"invited",to:"deprovisioned")=>void};
import { createPostgresFixture, type PostgresFixture } from "./testing/postgres-container";
import { listCurrentSeatPoolCounts } from "./pool-snapshots";
import { createInvitationWithdrawalService } from "./invitation-withdrawal";

const at = new Date("2026-10-02T15:00:00Z");
const sent = new Date("2026-09-20T15:00:00Z");
let fixture: PostgresFixture, owner: pg.Client, pool: pg.Pool;
beforeAll(async () => { fixture = await createPostgresFixture(); await fixture.migrate(); owner = await fixture.connectAsOwner(); pool = new pg.Pool({connectionString:fixture.ownerUrl}); },30000);
afterAll(async () => { await pool?.end(); await owner?.end(); await fixture?.stop(); });
async function seed() {
  const companyId=randomUUID(),foreignCompanyId=randomUUID(), vendor=randomUUID(), vendorAccountId=randomUUID(),license=randomUUID(),person=randomUUID(),requestId=randomUUID(),actionId=randomUUID(),actorUserId=randomUUID();
  await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'Withdraw A',$3,'internal','active',$4,'00000000-0000-0000-0000-000000000001'),($2,'Withdraw B',$5,'internal','active',$4,'00000000-0000-0000-0000-000000000001')`,[companyId,foreignCompanyId,companyId, sent,foreignCompanyId]);
  await owner.query(`INSERT INTO user_account(id,email,idp_subject,global_role,status,created_at,created_by) VALUES($1,$2,$3,'group_admin','active',$4,'00000000-0000-0000-0000-000000000001')`,[actorUserId,actorUserId+'@test.example',actorUserId,sent]);
  await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,$1::uuid::text,'api','rest',true,true,false,false,'email','active',$2,'00000000-0000-0000-0000-000000000001')`,[vendor,sent]);
  await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Withdraw account','automated',1,'active',$3,'00000000-0000-0000-0000-000000000001')`,[vendorAccountId,vendor,sent]);
  await owner.query(`INSERT INTO license_type(id,vendor_id,name,unit,status,created_at,created_by) VALUES($1,$2,'Withdraw seat','seat','active',$3,'00000000-0000-0000-0000-000000000001')`,[license,vendor,sent]);
  await owner.query(`INSERT INTO vendor_account_capacity(vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by) VALUES($1,$2,5,'2026-01-01',$3,'00000000-0000-0000-0000-000000000001')`,[vendorAccountId,license,sent]);
  await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,$2,'Withdraw person',$3,'active',$4,'00000000-0000-0000-0000-000000000001')`,[person,person+'@example.test',companyId,sent]);
  await owner.query(`INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,'invited','Need seat',$7,'00000000-0000-0000-0000-000000000001')`,[requestId,'REQ-'+requestId,person,companyId,vendorAccountId,license,sent]);
  await owner.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,sent_at,created_at) VALUES($1,$2,$3,'invite','automated','sent','invite-pinned',$4,$4)`,[actionId,requestId,vendorAccountId,sent]);
  return {companyId,foreignCompanyId,vendorAccountId,requestId,actionId,actorUserId,person,license,commandId:randomUUID(),note:"No longer needed"};
}
async function snapshot(input: Awaited<ReturnType<typeof seed>>) {
 const [capacity] = await listCurrentSeatPoolCounts(owner,{operatingDate:"2026-10-02",asOf:at,vendorAccountId:input.vendorAccountId});
 const request=(await owner.query(`SELECT state,license_assignment_id FROM license_request WHERE id=$1 AND company_id=$2`,[input.requestId,input.companyId])).rows[0];
 const assignments=(await owner.query(`SELECT id,ended_on FROM license_assignment WHERE company_id=$1 AND source_request_id=$2 ORDER BY id`,[input.companyId,input.requestId])).rows;
 return { request, available:capacity.purchased-capacity.assigned-capacity.pendingInvites,assignments };
}
function service(input: Awaited<ReturnType<typeof seed>>, options: { status?: string; body?: unknown; deleteStatus?:number; beforeDelete?:()=>Promise<void>; unsupported?:boolean; validator?:typeof assertLegalTransition } = {}) {
 const calls: {method:string;path:string}[]=[];
 const clock={now:()=>at.getTime()},sleep=async()=>undefined;
 const connector = createAnthropicConnector({credentialsFor:async()=>[
 {vendorAccountId:input.vendorAccountId,kind:"admin_scoped",secret:"contract-admin",status:"active",health:"ok"},
 {vendorAccountId:input.vendorAccountId,kind:"analytics",secret:"contract-analytics",status:"active",health:"ok"},
 ],observationSessionFor:async(context)=>createConnectorCallObservationSession({vendorAccountId:input.vendorAccountId,provisioningActionId:context.requestId ? observationAction : null, operation:context.operation,clock:()=>at,randomId:randomUUID,append:async(event)=>{
 await pool.query(`INSERT INTO connector_call_observation(vendor_account_id,provisioning_action_id,correlation_id,operation,attempt,phase,classification,summary,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[event.vendorAccountId,event.provisioningActionId,event.correlationId,event.operation,event.attempt,event.phase,event.classification,event.summary,event.occurredAt]);
 }}),requestDependencies:{clock,sleep,limiter:createAnthropicRateLimiter({clock,sleep}),transport:async(request)=>{
 const path=new URL(request.url).pathname;calls.push({method:request.method,path});
 if(request.method === "DELETE") { await options.beforeDelete?.(); return new Response(JSON.stringify(options.body ?? {id:"invite-pinned",type:"invite_deleted"}),{status:options.deleteStatus??200,headers:{"content-type":"application/json"}}); }
 return new Response(JSON.stringify({data:[{id:"invite-pinned",type:"invite",email:"selected@example.test",status:options.status??"pending"}],has_more:false,first_id:"invite-pinned",last_id:"invite-pinned"}),{headers:{"content-type":"application/json"}});
 }}});
 let observationAction:string;
 return {calls,service:createInvitationWithdrawalService({pool,now:()=>at,assertLegalTransition:options.validator??assertLegalTransition,connectorFor:async(context)=>{observationAction=context.withdrawalActionId;return options.unsupported?{...connector,withdrawInvitation:undefined}:connector;}})};
}

test("commits observed intent before I/O and releases exactly one reservation after matching success, once",async()=>{
 const input=await seed();const before=await snapshot(input);
 const execution=service(input,{beforeDelete:async()=>{
 const intent=(await owner.query(`SELECT status,raw_request FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows;
 expect(intent).toHaveLength(1);expect(intent[0].status).toBe("pending");expect(intent[0].raw_request).toMatchObject({actorUserId:input.actorUserId,note:input.note,actionId:input.actionId});
 expect((await snapshot(input)).available).toBe(before.available);
 const lock=(await owner.query(`SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked`,[input.actionId])).rows[0].locked;
 if(lock) await owner.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`,[input.actionId]);
 expect(lock).toBe(false);
 }});
 expect((await execution.service.withdraw(input)).ok).toBe(true);
 const after=await snapshot(input);expect(after.request.state).toBe("deprovisioned");expect(after.available-before.available).toBe(1);expect(after.assignments).toEqual(before.assignments);
 expect((await owner.query(`SELECT status FROM provisioning_action WHERE id=$1`,[input.actionId])).rows[0].status).toBe("withdrawn");
 expect((await owner.query(`SELECT actor_user_id,note FROM audit_log WHERE company_id=$1 AND entity_type='ProvisioningAction' AND action='invitation.withdrawn'`,[input.companyId])).rows).toEqual([{actor_user_id:input.actorUserId,note:input.note}]);
 expect((await execution.service.withdraw(input)).ok).toBe(true);
 expect(execution.calls.filter(c=>c.method === "DELETE").map(c=>c.path)).toEqual(["/v1/organizations/invites/invite-pinned"]);
 expect((await owner.query(`SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1`,[input.requestId])).rows[0].count).toBe(1);
},30000);

test.each(["foreign","stale","accepted","ambiguous","unsupported","note"])("%s refusal retains reservation and assignments",async(kind)=>{
 const input=await seed();const before=await snapshot(input);
 const execution=service(input,{status:kind === "accepted"?"accepted":undefined,body:kind === "ambiguous"?{id:"wrong",type:"invite_deleted"}:undefined,unsupported:kind === "unsupported"});
 const command={...input,...(kind === "foreign"?{companyId:input.foreignCompanyId}:{}),...(kind === "stale"?{actionId:randomUUID()}:{}),...(kind === "note"?{note:"  "}: {})};
 expect((await execution.service.withdraw(command)).ok).toBe(false);
 expect(await snapshot(input)).toEqual(before);
 expect(execution.calls.some(c=>c.path.includes("/users"))).toBe(false);
 if(kind !== "ambiguous") expect(execution.calls.filter(c=>c.method === "DELETE")).toEqual([]);
},30000);

test("state change after I/O refuses finalization and validated receipt recovers without another DELETE",async()=>{
 const input=await seed();const before=await snapshot(input);
 const execution=service(input,{beforeDelete:async()=>{await owner.query(`UPDATE license_request SET state='active' WHERE id=$1 AND company_id=$2`,[input.requestId,input.companyId]);}});
 expect((await execution.service.withdraw(input)).ok).toBe(false);
 expect((await snapshot(input)).available).toBe(before.available);
 await owner.query(`UPDATE license_request SET state='invited' WHERE id=$1 AND company_id=$2`,[input.requestId,input.companyId]);
 expect((await execution.service.withdraw(input)).ok).toBe(true);
 expect(execution.calls.filter(c=>c.method === "DELETE")).toHaveLength(1);
 expect((await snapshot(input)).available-before.available).toBe(1);
},30000);

test("requested-only intent refuses blind retry and failed lifecycle transaction releases original lock",async()=>{
 const input=await seed();const execution=service(input,{validator:()=>{throw new Error("LIFECYCLE_FAULT");}});
 await expect(execution.service.withdraw(input)).rejects.toThrow("LIFECYCLE_FAULT");
 expect((await snapshot(input)).request.state).toBe("invited");
 const lock=await owner.query(`SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked`,[input.actionId]);
 expect(lock.rows[0].locked).toBe(true);await owner.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`,[input.actionId]);
 await owner.query(`UPDATE provisioning_action SET raw_response=NULL WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId]);
 const retry=service(input);expect((await retry.service.withdraw(input)).ok).toBe(false);expect(retry.calls).toEqual([]);
},30000);

test("real membership poll cannot observe or activate the locked original invitation",async()=>{
 const input=await seed();
 const root=mkdtempSync(join(tmpdir(),"withdraw-kek-")),kekFile=join(root,"kek");
 const kek=Uint8Array.from({length:32},(_,index)=>index+1);writeFileSync(kekFile,Buffer.from(kek).toString("base64"));chmodSync(kekFile,0o400);
 for(const kind of ["admin_scoped","analytics"] as const) await owner.query(`INSERT INTO integration_credential(vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by) VALUES($1,$2,$3,'ok','active',$4,$5)`,[input.vendorAccountId,kind,JSON.stringify(await encryptCredential(kind+"-key",kek)),at,input.actorUserId]);
 const path=new URL("../../../apps/worker/src/jobs/membership-poll.ts",import.meta.url).href;
 const {createMembershipPollJob}=await import(path);
 let pollCalls=0;
 const poll=createMembershipPollJob({connectionString:fixture.ownerUrl,kekFile,allowedKekRoot:root,now:()=>at,sleep:async()=>undefined,transport:async()=>{pollCalls++;return new Response("{}",{headers:{"content-type":"application/json"}});}});
 try {
   const execution=service(input,{beforeDelete:async()=>{
     expect(await poll.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});
     expect(pollCalls).toBe(0);expect((await snapshot(input)).request.state).toBe("invited");
   }});
   expect((await execution.service.withdraw(input)).ok).toBe(true);
   expect((await snapshot(input)).request.state).toBe("deprovisioned");
 } finally {await poll.close();rmSync(root,{recursive:true,force:true});}
},30000);

test("acceptance racing DELETE retains the active assignment and no member removal occurs",async()=>{
 const input=await seed(),before=await snapshot(input),assignmentId=randomUUID();
 const execution=service(input,{deleteStatus:400,body:{error:{type:"invalid_request_error",message:"Invite accepted"}},beforeDelete:async()=>{
 await owner.query(`INSERT INTO license_assignment(id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_request_id,source_kind,note,created_at) VALUES($1,$2,$3,$4,$5,'2026-10-02',$6,'request','Accepted invitation',$7)`,[assignmentId,input.person,input.companyId,input.vendorAccountId,input.license,input.requestId,at]);
 await owner.query(`UPDATE license_request SET license_assignment_id=$1,state='active' WHERE id=$2 AND company_id=$3`,[assignmentId,input.requestId,input.companyId]);
 await owner.query(`UPDATE provisioning_action SET status='confirmed',resolved_at=$2 WHERE id=$1`,[input.actionId,at]);
 }});
 expect(await execution.service.withdraw(input)).toEqual({ok:false,error:"provider_error"});
 const after=await snapshot(input);expect(after.request).toEqual({state:"active",license_assignment_id:assignmentId});expect(after.assignments).toEqual([{id:assignmentId,ended_on:null}]);expect(after.available).toBe(before.available);
 expect(execution.calls.filter(c=>c.method === "DELETE").map(c=>c.path)).toEqual(["/v1/organizations/invites/invite-pinned"]);
 expect((await owner.query(`SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1 AND to_state='deprovisioned'`,[input.requestId])).rows[0].count).toBe(0);
},30000);

test("partial action status write rolls back transition and preserves the validated receipt for recovery",async()=>{
 const input=await seed(),before=await snapshot(input);
 const name="us068_partial_"+input.requestId.replaceAll("-","");
 const execution=service(input,{beforeDelete:async()=>{
 await owner.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${input.requestId}'::uuid AND NEW.kind='withdraw_invite' AND NEW.status='withdrawn' THEN RETURN NULL; END IF; RETURN NEW; END $$;
 CREATE TRIGGER ${name} BEFORE UPDATE ON provisioning_action FOR EACH ROW EXECUTE FUNCTION ${name}();`);
 }});
 try {
 await expect(execution.service.withdraw(input)).rejects.toThrow("WITHDRAWAL_ACTION_CONFLICT");
 expect(await snapshot(input)).toEqual(before);
 expect((await owner.query(`SELECT status,raw_response FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows).toEqual([{status:"pending",raw_response:{id:"invite-pinned",type:"invite_deleted"}}]);
 } finally {await owner.query(`DROP TRIGGER IF EXISTS ${name} ON provisioning_action; DROP FUNCTION IF EXISTS ${name}();`);}
 expect((await execution.service.withdraw(input)).ok).toBe(true);expect(execution.calls.filter(call=>call.method === "DELETE")).toHaveLength(1);
},30000);
