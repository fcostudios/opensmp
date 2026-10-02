import { mkdtempSync,writeFileSync,chmodSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { encryptCredential } from "./credential-crypto";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
const webRequire=createRequire(new URL("../../../apps/web/package.json",import.meta.url));
const {createAnthropicConnector}=await import(webRequire.resolve("@smp/connectors/providers/anthropic/connector")) as {createAnthropicConnector:import("./invitation-withdrawal").InvitationWithdrawalConnectorFactory};
const {createAnthropicRateLimiter}=await import(webRequire.resolve("@smp/connectors/providers/anthropic/rate-limiter")) as {createAnthropicRateLimiter:import("./invitation-withdrawal").InvitationWithdrawalLimiterFactory};
const {assertLegalTransition}=await import(webRequire.resolve("@smp/domain/request-workflow")) as {assertLegalTransition:(from:"invited",to:"deprovisioned")=>void};
import { createPostgresFixture, type PostgresFixture } from "./testing/postgres-container";
import { listCurrentSeatPoolCounts } from "./pool-snapshots";
import { createAuthorizedInvitationWithdrawal, createInvitationWithdrawalService, createProductionInvitationWithdrawalConnector } from "./invitation-withdrawal";

const at = new Date("2026-10-02T15:00:00Z");
const sent = new Date("2026-09-20T15:00:00Z");
let fixture: PostgresFixture, owner: pg.Client, pool: pg.Pool;
beforeAll(async () => { fixture = await createPostgresFixture(); await fixture.migrate(); owner = await fixture.connectAsOwner(); pool = new pg.Pool({connectionString:fixture.ownerUrl}); },30000);
afterAll(async () => { await pool?.end(); await owner?.end(); await fixture?.stop(); });
afterEach(async()=>{
 expect((await owner.query(`SELECT pid,state FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'`)).rows).toEqual([]);
 expect((await owner.query(`SELECT lock.pid FROM pg_locks lock JOIN pg_stat_activity activity ON activity.pid=lock.pid WHERE activity.datname=current_database() AND lock.locktype='advisory'`)).rows).toEqual([]);
});
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
 expect(intent).toHaveLength(1);expect(intent[0].status).toBe("pending");expect(intent[0].raw_request).toMatchObject({actorUserId:input.actorUserId,actorLabel:input.actorUserId+"@test.example",note:input.note,actionId:input.actionId});
 expect((await snapshot(input)).available).toBe(before.available);
 const lock=(await owner.query(`SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked`,[input.actionId])).rows[0].locked;
 if(lock) await owner.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`,[input.actionId]);
 expect(lock).toBe(false);
 }});
 expect((await execution.service.withdraw(input)).ok).toBe(true);
 const after=await snapshot(input);expect(after.request.state).toBe("deprovisioned");expect(after.available-before.available).toBe(1);expect(after.assignments).toEqual(before.assignments);
 expect((await owner.query(`SELECT status FROM provisioning_action WHERE id=$1`,[input.actionId])).rows[0].status).toBe("withdrawn");
 expect((await owner.query(`SELECT actor_user_id,note,after FROM audit_log WHERE company_id=$1 AND entity_type='ProvisioningAction' AND action='invitation.withdrawn'`,[input.companyId])).rows).toEqual([{actor_user_id:input.actorUserId,note:input.note,after:{originalActionId:input.actionId,vendorRef:"invite-pinned"}}]);
 expect((await execution.service.withdraw(input)).ok).toBe(true);
 expect(execution.calls.filter(c=>c.method === "DELETE").map(c=>c.path)).toEqual(["/v1/organizations/invites/invite-pinned"]);
 expect((await owner.query(`SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1`,[input.requestId])).rows[0].count).toBe(1);
},30000);

test.each(["foreign","stale","accepted","ambiguous","unsupported","note","non200"])("%s refusal retains reservation and assignments",async(kind)=>{
 const input=await seed();const before=await snapshot(input);
 const execution=service(input,{status:kind === "accepted"?"accepted":undefined,body:kind === "ambiguous"?{id:"wrong",type:"invite_deleted"}:undefined,unsupported:kind === "unsupported",deleteStatus:kind === "non200"?202:undefined});
 const command={...input,...(kind === "foreign"?{companyId:input.foreignCompanyId}:{}),...(kind === "stale"?{actionId:randomUUID()}:{}),...(kind === "note"?{note:"  "}: {})};
 expect((await execution.service.withdraw(command)).ok).toBe(false);
 expect(await snapshot(input)).toEqual(before);
 expect(execution.calls.some(c=>c.path.includes("/users"))).toBe(false);
 if(kind !== "ambiguous" && kind !== "non200") expect(execution.calls.filter(c=>c.method === "DELETE")).toEqual([]);
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


test("bounded pool lock holder uses its own client for production credentials and observations",async()=>{
 const input=await seed(),before=await snapshot(input);
 const bounded=new pg.Pool({connectionString:fixture.ownerUrl,max:2,connectionTimeoutMillis:1000});
 const root=mkdtempSync(join(tmpdir(),"withdraw-production-kek-")),kekFile=join(root,"kek");
 const kek=Uint8Array.from({length:32},(_,index)=>index+1);writeFileSync(kekFile,Buffer.from(kek).toString("base64"));chmodSync(kekFile,0o400);
 for(const kind of ["admin_scoped","analytics"] as const) await owner.query(`INSERT INTO integration_credential(vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by) VALUES($1,$2,$3,'ok','active',$4,$5)`,[input.vendorAccountId,kind,JSON.stringify(await encryptCredential(kind+"-key",kek)),at,input.actorUserId]);
 const {parseCredentialEnvelope}=await import(webRequire.resolve("@smp/domain"));
 let started!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const calls:string[]=[];
 const network=vi.spyOn(globalThis,"fetch").mockImplementation(async(request)=>{
 const outbound=request as Request;calls.push(outbound.method);
 expect(outbound.headers.get("x-api-key")).toBe("admin_scoped-key");
 if(outbound.method === "GET") {started();await gate;return new Response(JSON.stringify({data:[{id:"invite-pinned",type:"invite",email:"selected@example.test",status:"pending"}],has_more:false,first_id:"invite-pinned",last_id:"invite-pinned"}),{headers:{"content-type":"application/json"}});}
 return new Response(JSON.stringify({id:"invite-pinned",type:"invite_deleted"}),{headers:{"content-type":"application/json"}});
 });
 const execution=createInvitationWithdrawalService({pool:bounded,now:()=>at,assertLegalTransition,connectorFor:async(context,client)=>createProductionInvitationWithdrawalConnector({database:client,now:()=>at,createConnector:createAnthropicConnector,createLimiter:createAnthropicRateLimiter,parseCredentialEnvelope,kekFile,allowedKekRoot:root})(context)});
 try {
 const {withAudit}=await import(new URL("../../../apps/web/src/modules/audit/with-audit.ts",import.meta.url).href);
 const submit=async(command:typeof input)=>{const outcome=await execution.withdraw(command);return withAudit(drizzle(bounded),async()=>({value:outcome,audit:{actorUserId:input.actorUserId,action:"server_action.withdrawInvite",entityType:"LicenseRequest",entityId:input.requestId,companyId:input.companyId,note:null,before:null,after:outcome}}),{occurredAt:at});};
 const first=submit(input);await Promise.race([entered,first.then(()=>{throw new Error("PROVIDER_GET_NOT_REACHED");})]);
 const acquired=new Promise<void>(resolve=>bounded.once("acquire",()=>resolve()));
 const second=submit(input);await acquired;
 let waiting=false;
 for(let attempt=0;attempt<100&&!waiting;attempt++)waiting=(await owner.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`)).rows[0].waiting;
 expect(waiting).toBe(true);expect(bounded.totalCount).toBe(2);expect((await snapshot(input)).available).toBe(before.available);
 release();const results=await Promise.allSettled([first,second]);
 expect(results).toEqual([{status:"fulfilled",value:expect.objectContaining({ok:true})},{status:"fulfilled",value:expect.objectContaining({ok:true})}]);
 expect(calls).toEqual(["GET","DELETE"]);expect((await snapshot(input)).available-before.available).toBe(1);
 const after=await snapshot(input);expect(await submit({...input,commandId:randomUUID()})).toEqual({ok:false,error:"conflict"});expect(await snapshot(input)).toEqual(after);
 expect((await owner.query(`SELECT action,count(*)::int AS count FROM audit_log WHERE company_id=$1 AND action IN ('invitation.withdrawn','server_action.withdrawInvite') GROUP BY action ORDER BY action`,[input.companyId])).rows).toEqual([{action:"invitation.withdrawn",count:1},{action:"server_action.withdrawInvite",count:3}]);
 expect((await owner.query(`SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1`,[input.requestId])).rows[0].count).toBe(1);
 expect((await owner.query(`SELECT operation,phase FROM connector_call_observation observation JOIN provisioning_action action ON action.id=observation.provisioning_action_id WHERE action.request_id=$1 ORDER BY observation.occurred_at,observation.id`,[input.requestId])).rows).toHaveLength(4);
 }finally{release();network.mockRestore();await bounded.end();rmSync(root,{recursive:true,force:true});}
},10000);


test.each(["companyId","requestId","actionId","commandId","actorUserId"] as const)("invalid %s command identity refuses without database state or provider changes",async(field)=>{
 const input=await seed(),before=await snapshot(input),execution=service(input);
 expect(await execution.service.withdraw({...input,[field]:"invalid"})).toEqual({ok:false,error:"invalid"});expect(await snapshot(input)).toEqual(before);expect(execution.calls).toEqual([]);
});
test("overlong note refuses and nullable trusted system actor is recorded",async()=>{
 const input=await seed(),before=await snapshot(input),execution=service(input);
 expect(await execution.service.withdraw({...input,note:"x".repeat(2001)})).toEqual({ok:false,error:"invalid"});expect(await snapshot(input)).toEqual(before);expect(execution.calls).toEqual([]);
 expect((await execution.service.withdraw({...input,actorUserId:null})).ok).toBe(true);
 expect((await owner.query(`SELECT raw_request->'actorUserId' AS actor,raw_request->'actorLabel' AS label FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows).toEqual([{actor:null,label:null}]);
});
test("a durable completed command refuses changed actor or note without another provider call",async()=>{
 const input=await seed(),execution=service(input);expect((await execution.service.withdraw(input)).ok).toBe(true);const before=await snapshot(input);
 for(const changed of [{note:"Different reason"},{actorUserId:randomUUID()},{commandId:randomUUID()}]){expect(await execution.service.withdraw({...input,...changed})).toEqual({ok:false,error:"conflict"});expect(await snapshot(input)).toEqual(before);}
 expect(execution.calls.filter(call=>call.method === "DELETE")).toHaveLength(1);
});


async function authorized(input:Awaited<ReturnType<typeof seed>>,mode:"admin"|"nonadmin"|"anonymous"="admin",fault=false){
 const {createAuthorizationRepository}=await import(new URL("../../../apps/web/src/modules/identity-access/authorization.ts",import.meta.url).href);
 const {withAudit}=await import(new URL("../../../apps/web/src/modules/audit/with-audit.ts",import.meta.url).href);
 if(mode === "nonadmin")await owner.query(`UPDATE user_account SET global_role=NULL WHERE id=$1`,[input.actorUserId]);
 const repository=createAuthorizationRepository(drizzle(pool));const execution=service(input,{validator:fault?()=>{throw new Error("FINALIZATION_FAULT");}:undefined});
 const recorded:{actor:string|null;request:string|null}[]=[];
 const execute=createAuthorizedInvitationWithdrawal({pool,loadAuthorization:async()=>mode === "anonymous"?null:repository.load({subject:input.actorUserId}),service:execution.service,recordOutcome:async(actor,request,outcome)=>{recorded.push({actor,request});await withAudit(drizzle(pool),async()=>({value:outcome,audit:{actorUserId:actor,action:"server_action.withdrawInvite",entityType:"LicenseRequest",entityId:request??input.requestId,companyId:null,note:null,before:null,after:outcome}}),{occurredAt:at});}});
 const form=new FormData();for(const key of ["requestId","actionId","commandId","note"] as const)form.set(key,input[key]);form.set("actorUserId",randomUUID());form.set("companyId",input.foreignCompanyId);
 return {...execution,execute,form,recorded};
}
test.each(["admin","nonadmin","anonymous"] as const)("real authorization %s supplies trusted identity and audits exact outcome",async(mode)=>{
 const input=await seed(),before=await snapshot(input),execution=await authorized(input,mode);
 const outcome=await execution.execute(execution.form);expect(outcome).toEqual(mode === "admin"?{ok:true,requestId:input.requestId,actionId:expect.any(String)}:{ok:false,error:"forbidden"});
 expect(execution.recorded).toEqual([{actor:mode === "anonymous"?null:input.actorUserId,request:input.requestId}]);
 expect((await owner.query(`SELECT actor_user_id,after FROM audit_log WHERE entity_id=$1 AND action='server_action.withdrawInvite'`,[input.requestId])).rows).toEqual([{actor_user_id:mode === "anonymous"?null:input.actorUserId,after:outcome}]);
 if(mode === "admin"){expect((await snapshot(input)).available-before.available).toBe(1);expect((await owner.query(`SELECT raw_request->>'companyId' AS company,raw_request->>'actorUserId' AS actor FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows).toEqual([{company:input.companyId,actor:input.actorUserId}]);}else{expect(await snapshot(input)).toEqual(before);expect(execution.calls).toEqual([]);}
});
test.each(["requestId","actionId","commandId","note"] as const)("authorized invalid %s refuses, attributes denial and retains reservation",async(field)=>{
 const input=await seed(),before=await snapshot(input),execution=await authorized(input);execution.form.set(field,field === "note"?"   ":"invalid");
 expect(await execution.execute(execution.form)).toEqual({ok:false,error:"invalid"});expect(await snapshot(input)).toEqual(before);expect(execution.calls).toEqual([]);expect(execution.recorded).toEqual([{actor:input.actorUserId,request:field === "requestId"?null:input.requestId}]);
});
test("authorized missing identities, inaccessible request and overlong note fail closed",async()=>{
 const input=await seed(),before=await snapshot(input),execution=await authorized(input);
 for(const field of ["requestId","actionId","commandId","note"] as const){const form=new FormData();for(const [key,value] of execution.form)if(key!==field)form.set(key,value);expect(await execution.execute(form)).toEqual({ok:false,error:"invalid"});}
 execution.form.set("note","x".repeat(2001));expect(await execution.execute(execution.form)).toEqual({ok:false,error:"invalid"});execution.form.set("note","Needed");execution.form.set("requestId",randomUUID());expect(await execution.execute(execution.form)).toEqual({ok:false,error:"forbidden"});
 expect(await snapshot(input)).toEqual(before);expect(execution.calls).toEqual([]);
});
test("exact note limit is allowed, whitespace is normalized and service fault is audited as ambiguous",async()=>{
 const input=await seed(),execution=await authorized(input);execution.form.set("note","x".repeat(2000));expect((await execution.execute(execution.form)).ok).toBe(true);
 const faultInput=await seed(),before=await snapshot(faultInput),fault=await authorized(faultInput,"admin",true);fault.form.set("note","  Trimmed note  ");expect(await fault.execute(fault.form)).toEqual({ok:false,error:"ambiguous"});expect(await snapshot(faultInput)).toEqual(before);
 expect((await owner.query(`SELECT raw_request->>'note' AS note,raw_response FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[faultInput.requestId])).rows).toEqual([{note:"Trimmed note",raw_response:{id:"invite-pinned",type:"invite_deleted"}}]);
 expect((await owner.query(`SELECT actor_user_id,after FROM audit_log WHERE entity_id=$1 AND action='server_action.withdrawInvite'`,[faultInput.requestId])).rows).toEqual([{actor_user_id:faultInput.actorUserId,after:{ok:false,error:"ambiguous"}}]);
});


test("persisted malformed confirmation cannot recover or contact the provider",async()=>{
 const input=await seed(),before=await snapshot(input),initial=service(input,{validator:()=>{throw new Error("FINALIZATION_FAULT");}});await expect(initial.service.withdraw(input)).rejects.toThrow("FINALIZATION_FAULT");
 const retry=service(input);
 for(const receipt of [null,[],{}, {id:"other",type:"invite_deleted"},{id:"invite-pinned",type:"user_deleted"},{id:"invite-pinned",type:"invite_deleted",extra:true}]){
 await owner.query(`UPDATE provisioning_action SET raw_response=$2::jsonb WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId,JSON.stringify(receipt)]);
 expect(await retry.service.withdraw(input)).toEqual({ok:false,error:"ambiguous"});expect(await snapshot(input)).toEqual(before);expect(retry.calls).toEqual([]);
 }
 await owner.query(`UPDATE provisioning_action SET raw_response=$2::jsonb WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId,JSON.stringify({id:"invite-pinned",type:"invite_deleted"})]);
 expect((await retry.service.withdraw(input)).ok).toBe(true);expect(retry.calls).toEqual([]);expect((await snapshot(input)).available-before.available).toBe(1);
});
test.each(["actorUserId","companyId","actionId","commandId","note","status"] as const)("intent %s changed during provider I/O cannot finalize or release capacity",async(field)=>{
 const input=await seed(),before=await snapshot(input),changed=field === "note"?"Tampered note":randomUUID();
 const execution=service(input,{beforeDelete:async()=>{
 if(field === "status")await owner.query(`UPDATE provisioning_action SET status='failed' WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId]);
 else await owner.query(`UPDATE provisioning_action SET raw_request=jsonb_set(raw_request,ARRAY[$2],$3::jsonb) WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId,field,JSON.stringify(changed)]);
 }});
 expect(await execution.service.withdraw(input)).toEqual({ok:false,error:"conflict"});expect(await snapshot(input)).toEqual(before);expect(execution.calls.filter(call=>call.method === "DELETE")).toHaveLength(1);
});
test("latest invitation and pinned reference are rechecked after provider I/O",async()=>{
 for(const latest of [false,true]){
 const input=await seed(),before=await snapshot(input);
 const execution=service(input,{beforeDelete:async()=>{
 if(latest)await owner.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,sent_at,created_at) VALUES($1,$2,$3,'invite','automated','sent','invite-new',$4,$4)`,[randomUUID(),input.requestId,input.vendorAccountId,new Date(at.getTime()+1)]);
 else await owner.query(`UPDATE provisioning_action SET vendor_ref='invite-changed' WHERE id=$1`,[input.actionId]);
 }});
 expect(await execution.service.withdraw(input)).toEqual({ok:false,error:"conflict"});expect(await snapshot(input)).toEqual(before);expect(execution.calls.filter(call=>call.method === "DELETE")).toHaveLength(1);
 }
});
test("anchored UUID and command scalar types reject malformed internal commands before I/O",async()=>{
 const input=await seed(),before=await snapshot(input),execution=service(input);
 for(const command of [{...input,commandId:"prefix"+input.commandId},{...input,commandId:input.commandId+"suffix"},{...input,actorUserId:7},{...input,note:7},{...input,requestId:null}]){expect(await execution.service.withdraw(command as unknown as typeof input)).toEqual({ok:false,error:"invalid"});expect(await snapshot(input)).toEqual(before);}
 expect(execution.calls).toEqual([]);
});


test("missing and overlong trusted actor refuse before intent while exact actor-label bound is durable",async()=>{
 for(const label of [null,"x".repeat(321)]){
  const input=await seed(),before=await snapshot(input),execution=service(input);
  if(label!==null)await owner.query(`UPDATE user_account SET email=$2 WHERE id=$1`,[input.actorUserId,label]);
  expect(await execution.service.withdraw({...input,actorUserId:label===null?randomUUID():input.actorUserId})).toEqual({ok:false,error:"conflict"});
  expect(await snapshot(input)).toEqual(before);expect(execution.calls).toEqual([]);expect((await owner.query(`SELECT id FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows).toEqual([]);
 }
 const input=await seed(),execution=service(input),label="x".repeat(320);
 await owner.query(`UPDATE user_account SET email=$2 WHERE id=$1`,[input.actorUserId,label]);expect((await execution.service.withdraw(input)).ok).toBe(true);
 expect((await owner.query(`SELECT raw_request->>'actorLabel' AS label FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows).toEqual([{label}]);
});
test("completed intent with foreign company metadata cannot be replayed as success",async()=>{
 const input=await seed(),execution=service(input);expect((await execution.service.withdraw(input)).ok).toBe(true);const before=await snapshot(input);
 await owner.query(`UPDATE provisioning_action SET raw_request=jsonb_set(raw_request,'{companyId}',$2::jsonb) WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId,JSON.stringify(input.foreignCompanyId)]);
 expect(await execution.service.withdraw(input)).toEqual({ok:false,error:"conflict"});expect(await snapshot(input)).toEqual(before);expect(execution.calls.filter(call=>call.method==='DELETE')).toHaveLength(1);
});
test.each(["status","vendor_ref","commandId"])("%s changed after durable receipt write cannot finalize and restored receipt recovers without DELETE",async(field)=>{
 const input=await seed(),before=await snapshot(input),execution=service(input),name="us068_receipt_"+input.requestId.replaceAll("-","");
 const change=field==='status'?"status='failed'":field==='vendor_ref'?"vendor_ref='invite-foreign'":`raw_request=jsonb_set(raw_request,'{commandId}','"${randomUUID()}"'::jsonb)`;
 await owner.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE provisioning_action SET ${change} WHERE id=NEW.id;RETURN NEW;END $$;CREATE TRIGGER ${name} AFTER UPDATE ON provisioning_action FOR EACH ROW WHEN (NEW.request_id='${input.requestId}'::uuid AND NEW.kind='withdraw_invite' AND NEW.raw_response IS DISTINCT FROM OLD.raw_response) EXECUTE FUNCTION ${name}();`);
 try{expect(await execution.service.withdraw(input)).toEqual({ok:false,error:"conflict"});expect(await snapshot(input)).toEqual(before);}finally{await owner.query(`DROP TRIGGER ${name} ON provisioning_action;DROP FUNCTION ${name}();`);}
 await owner.query(`UPDATE provisioning_action SET status='pending',vendor_ref='invite-pinned',raw_request=jsonb_set(raw_request,'{commandId}',$2::jsonb) WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId,JSON.stringify(input.commandId)]);
 expect((await execution.service.withdraw(input)).ok).toBe(true);expect((await snapshot(input)).available-before.available).toBe(1);expect(execution.calls.filter(call=>call.method==='DELETE')).toHaveLength(1);
});

test("real production connector rejects a different account before network and unsupported protocol returns null",async()=>{
 const input=await seed(),root=mkdtempSync(join(tmpdir(),"us068-account-")),kekFile=join(root,"kek");writeFileSync(kekFile,Buffer.alloc(32,7).toString("base64"));chmodSync(kekFile,0o400);
 const {parseCredentialEnvelope}=await import(webRequire.resolve("@smp/domain"));
 const factory=createProductionInvitationWithdrawalConnector({database:owner,now:()=>at,createConnector:createAnthropicConnector,createLimiter:createAnthropicRateLimiter,parseCredentialEnvelope,kekFile,allowedKekRoot:root});
 const context={companyId:input.companyId,requestId:input.requestId,actionId:input.actionId,vendorAccountId:input.vendorAccountId,vendorRef:"invite-pinned",withdrawalActionId:randomUUID()};
 const network=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{throw new Error("UNEXPECTED_PROVIDER_NETWORK");});
 try{
  const connector=await factory(context);expect(connector).not.toBeNull();await expect(connector!.withdrawInvitation!({requestId:input.requestId,vendorAccountId:randomUUID(),vendorRef:"invite-pinned"})).rejects.toThrow("WITHDRAWAL_ACCOUNT_MISMATCH");expect(network).not.toHaveBeenCalled();
  await owner.query(`UPDATE vendor SET provisioning_protocol='none' WHERE id=(SELECT vendor_id FROM vendor_account WHERE id=$1)`,[input.vendorAccountId]);expect(await factory(context)).toBeNull();
  expect(await factory({...context,vendorAccountId:randomUUID()})).toBeNull();expect(network).not.toHaveBeenCalled();
 }finally{network.mockRestore();rmSync(root,{recursive:true,force:true});}
});


test("preparation keeps request rows locked until durable withdrawal intent commits",async()=>{
 const input=await seed(),before=await snapshot(input),execution=service(input),name="us068_prepare_"+input.requestId.replaceAll("-","");
 const writer=new pg.Client({connectionString:fixture.ownerUrl});await writer.connect();const writerPid=(await writer.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
 const ownerPid=(await owner.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
 await owner.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('${name}',0));RETURN NEW;END $$;CREATE TRIGGER ${name} BEFORE INSERT ON provisioning_action FOR EACH ROW WHEN (NEW.request_id='${input.requestId}'::uuid AND NEW.kind='withdraw_invite') EXECUTE FUNCTION ${name}();`);
 await owner.query(`SELECT pg_advisory_lock(hashtextextended($1,0))`,[name]);
 const pending=execution.service.withdraw(input);let writing:Promise<pg.QueryResult>|undefined;
 async function until<T>(probe:()=>Promise<T|undefined>,unexpected:Promise<unknown>):Promise<T>{
  for(let attempts=0;attempts<1000;attempts++){const value=await Promise.race([probe(),unexpected]);if(value!==undefined)return value as T;}throw new Error("PREPARATION_LOCK_NOT_OBSERVED");
 }
 try{
  const finishedTooSoon=pending.then(()=>{throw new Error("INTENT_INSERT_DID_NOT_WAIT_FOR_BARRIER");});
  const holder=await until(async()=>{const result=await owner.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%INSERT INTO provisioning_action%'`,[ownerPid]);return result.rows[0]?.pid as number|undefined;},finishedTooSoon);
  writing=writer.query(`UPDATE license_request SET justification='Competing writer' WHERE id=$1 AND company_id=$2`,[input.requestId,input.companyId]);
  const wroteTooSoon=writing.then(()=>{throw new Error("PREPARATION_REQUEST_ROW_NOT_LOCKED");});
  const blockers=await until(async()=>{const result=await owner.query(`SELECT pg_blocking_pids($1) AS pids`,[writerPid]);return result.rows[0].pids.includes(holder)?result.rows[0].pids as number[]:undefined;},wroteTooSoon);
  expect(blockers).toContain(holder);
  await owner.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`,[name]);expect((await pending).ok).toBe(true);await writing;
  expect((await snapshot(input)).available-before.available).toBe(1);expect(execution.calls.filter(call=>call.method==='DELETE')).toHaveLength(1);
 }finally{
  await owner.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`,[name]);await pending;await writing;await owner.query(`DROP TRIGGER ${name} ON provisioning_action;DROP FUNCTION ${name}();`);await writer.end();
 }
},10000);
