import "next/dist/server/node-environment";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestRecord, type RequestRecordLabels } from "../../../components/requests/request-record";
import { createRequestReadRepository } from "../read-repository";
import en from "../../../../messages/en-US.json";
import { getNotificationCatalog } from "@smp/notifications/catalog";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { db as productionDatabase } from "@smp/db";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import ts from "typescript";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import { listCurrentSeatPoolCounts } from "@smp/db/pool-snapshots";
import { createAuthorizedInvitationWithdrawal, createInvitationWithdrawalService } from "@smp/db/invitation-withdrawal";
import type { VendorConnector } from "@smp/connectors/contracts";
const require=createRequire(import.meta.url);
const {createAnthropicConnector}=await import(require.resolve("@smp/connectors/providers/anthropic/connector")) as {createAnthropicConnector:(dependencies:{credentialsFor:(id:string)=>Promise<readonly {vendorAccountId:string;kind:"admin_scoped"|"analytics";secret:string;status:"active"|"retired";health:"ok"|"auth_failed"|"unverified"}[]>;observationSessionFor:(input:{operation:Parameters<typeof createConnectorCallObservationSession>[0]["operation"]})=>Promise<ReturnType<typeof createConnectorCallObservationSession>>;requestDependencies:{clock:{now:()=>number};sleep:()=>Promise<void>;limiter:ReturnType<typeof createAnthropicRateLimiter>;transport:(request:Request)=>Promise<Response>}})=>VendorConnector};
const {createAnthropicRateLimiter}=await import(require.resolve("@smp/connectors/providers/anthropic/rate-limiter")) as {createAnthropicRateLimiter:(input:{clock:{now:()=>number};sleep:()=>Promise<void>})=>{acquire:(account:string,budgets:readonly ("user_management"|"analytics"|"invite_create")[])=>Promise<void>}};
import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
import { assertLegalTransition } from "@smp/domain/request-workflow";
import { withdrawInvite } from "./withdraw-invite";
import { createServerAuthorizationEntrypoints } from "../../identity-access/server-authorization";
import { createAuthorizationRepository } from "../../identity-access/authorization";
import { withAudit } from "../../audit/with-audit";

let fixture:PostgresFixture, owner:pg.Client,pool:pg.Pool;
let unregisterAuthLoader:()=>Promise<void>;
let unregisterCompositionLoader:()=>void;
const productionPool=(productionDatabase as unknown as {$client:pg.Pool}).$client;
const savedAuthEnvironment={AUTH_SECRET:process.env.AUTH_SECRET,AUTH_URL:process.env.AUTH_URL,AUTH_TRUST_HOST:process.env.AUTH_TRUST_HOST};
const at=new Date("2026-10-02T15:00:00Z");
beforeAll(async()=>{unregisterAuthLoader=require("tsx/esm/api").register({tsconfig:false});unregisterCompositionLoader=require("tsx/cjs/api").register();fixture=await createPostgresFixture();await fixture.migrate();owner=await fixture.connectAsOwner();pool=new pg.Pool({connectionString:fixture.ownerUrl,max:2,connectionTimeoutMillis:1000});productionPool.options.connectionString=fixture.ownerUrl;productionPool.options.max=2;productionPool.options.connectionTimeoutMillis=1000;process.env.AUTH_SECRET="us068-verified-session-fixture-secret";process.env.AUTH_URL="http://localhost:3000";process.env.AUTH_TRUST_HOST="true";},30000);
afterAll(async()=>{await unregisterAuthLoader?.();unregisterCompositionLoader?.();await productionPool.end();await pool?.end();await owner?.end();await fixture?.stop();for(const [key,value] of Object.entries(savedAuthEnvironment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
async function arrange(role:"group_admin"|null) {
 const actor=randomUUID(),company=randomUUID(),vendor=randomUUID(),account=randomUUID(),license=randomUUID(),person=randomUUID(),request=randomUUID(),action=randomUUID();
 await owner.query(`INSERT INTO user_account(id,email,idp_subject,global_role,status,created_at) VALUES($1,$2,$1::uuid::text,$3,'active',$4)`,[actor,actor+"@auth.test",role,at]);
 await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,$1::uuid::text,$1::uuid::text,'internal','active',$2,$3)`,[company,at,actor]);
 await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,$1::uuid::text,'api','rest',true,true,false,false,'email','active',$2,$3)`,[vendor,at,actor]);
 await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,$1::uuid::text,'automated',1,'active',$3,$4)`,[account,vendor,at,actor]);
 await owner.query(`INSERT INTO license_type(id,vendor_id,name,unit,status,created_at,created_by) VALUES($1,$2,$1::uuid::text,'seat','active',$3,$4)`,[license,vendor,at,actor]);
 await owner.query(`INSERT INTO vendor_account_capacity(vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by) VALUES($1,$2,5,'2026-01-01',$3,$4)`,[account,license,at,actor]);
 await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,$2,'Person',$3,'active',$4,$5)`,[person,person+"@auth.test",company,at,actor]);
 await owner.query(`INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by) VALUES($1,$1::uuid::text,$2,$3,$4,$5,'invited','Need',$6,$7)`,[request,person,company,account,license,at,actor]);
 await owner.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,sent_at,created_at) VALUES($1,$2,$3,'invite','automated','sent','invite-pinned',$4,$4)`,[action,request,account,at]);
 const clock={now:()=>at.getTime()},sleep=async()=>undefined;
 let remoteCalls=0;let observationClient:pg.PoolClient,observationAction:string;
 const connector=createAnthropicConnector({credentialsFor:async()=>[
 {vendorAccountId:account,kind:"admin_scoped",secret:"admin",status:"active",health:"ok"},{vendorAccountId:account,kind:"analytics",secret:"analytics",status:"active",health:"ok"},
 ],observationSessionFor:async(operation)=>createConnectorCallObservationSession({vendorAccountId:account,provisioningActionId:observationAction,operation:operation.operation,clock:()=>at,randomId:randomUUID,append:async(event)=>{
 await observationClient.query(`INSERT INTO connector_call_observation(vendor_account_id,provisioning_action_id,correlation_id,operation,attempt,phase,classification,summary,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[event.vendorAccountId,event.provisioningActionId,event.correlationId,event.operation,event.attempt,event.phase,event.classification,event.summary,event.occurredAt]);
 }}),requestDependencies:{clock,sleep,limiter:createAnthropicRateLimiter({clock,sleep}),transport:async(input)=>{
 remoteCalls++;return new Response(JSON.stringify(input.method === "DELETE"?{id:"invite-pinned",type:"invite_deleted"}:{data:[{id:"invite-pinned",type:"invite",email:"selected@example.test",status:"pending"}],has_more:false,first_id:"invite-pinned",last_id:"invite-pinned"}),{headers:{"content-type":"application/json"}});
 }}});
 const database=drizzle(pool,{schema});
 const entrypoints=createServerAuthorizationEntrypoints({loadSession:async()=>({user:{idpSubject:actor}}),repository:createAuthorizationRepository(database)});
 const execute=createAuthorizedInvitationWithdrawal({pool,loadAuthorization:entrypoints.loadCurrentLedgerAuthorization,service:createInvitationWithdrawalService({pool,now:()=>at,assertLegalTransition,connectorFor:async(context,client)=>{observationClient=client;observationAction=context.withdrawalActionId;return connector;}}),recordOutcome:async(userId,requestId,outcome)=>{await withAudit(database,async()=>({value:outcome,audit:{actorUserId:userId,action:"server_action.withdrawInvite",entityType:"LicenseRequest",entityId:requestId??request,companyId:company,note:null,before:null,after:outcome}}),{occurredAt:at});}});
 const form=new FormData();form.set("requestId",request);form.set("actionId",action);form.set("commandId",action);form.set("note","Required withdrawal note");form.set("actorUserId",randomUUID());form.set("companyId",randomUUID());form.set("actorLabel","FORGED ACTOR");
 return {execute,form,actor,company,request,action,account,vendor,database,entrypoints,remoteCalls:()=>remoteCalls};
}
test("non-admin cannot withdraw and denial is audited without provider calls",async()=>{
 const fixture=await arrange(null);expect(await fixture.execute(fixture.form)).toEqual({ok:false,error:"forbidden"});expect(fixture.remoteCalls()).toBe(0);
 expect((await owner.query(`SELECT state FROM license_request WHERE id=$1 AND company_id=$2`,[fixture.request,fixture.company])).rows[0].state).toBe("invited");
 expect((await owner.query(`SELECT actor_user_id,after FROM audit_log WHERE entity_id=$1 AND action='server_action.withdrawInvite'`,[fixture.request])).rows).toEqual([{actor_user_id:fixture.actor,after:{ok:false,error:"forbidden"}}]);
});
test("trusted DB authorization supplies actor and company, caller cannot forge them",async()=>{
 const fixture=await arrange("group_admin");expect((await fixture.execute(fixture.form)).ok).toBe(true);
 expect((await owner.query(`SELECT actor_user_id,note,company_id FROM audit_log WHERE action='invitation.withdrawn' AND company_id=$1`,[fixture.company])).rows).toEqual([{actor_user_id:fixture.actor,note:"Required withdrawal note",company_id:fixture.company}]);
});
test("required note and an inaccessible request refuse before provider I/O",async()=>{
 const fixture=await arrange("group_admin");fixture.form.set("note","   ");expect(await fixture.execute(fixture.form)).toEqual({ok:false,error:"invalid"});
 fixture.form.set("note","Required");fixture.form.set("requestId",randomUUID());expect(await fixture.execute(fixture.form)).toEqual({ok:false,error:"forbidden"});expect(fixture.remoteCalls()).toBe(0);
});
test("production action composes trusted authorization, lifecycle, audited service and async-only remote entrypoint",()=>{
 expect(typeof withdrawInvite).toBe("function");
 const source=ts.createSourceFile("withdraw-invite.ts",readFileSync(new URL("./withdraw-invite.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const exported=source.statements.filter(statement=>ts.canHaveModifiers(statement)&&ts.getModifiers(statement)?.some(mod=>mod.kind===ts.SyntaxKind.ExportKeyword));
 expect(exported).toHaveLength(1);expect(exported.every(statement=>ts.isFunctionDeclaration(statement)&&statement.modifiers?.some(mod=>mod.kind===ts.SyntaxKind.AsyncKeyword))).toBe(true);
 const imports=source.statements.filter(ts.isImportDeclaration).map(statement=>statement.moduleSpecifier.getText(source));
 expect(imports).toContain('"@smp/db/invitation-withdrawal"');expect(imports).toContain('"@smp/domain/request-workflow"');
 const calls:string[]=[];function visit(node:ts.Node){if(ts.isCallExpression(node))calls.push(node.expression.getText(source));ts.forEachChild(node,visit);}visit(source);
 const wrapper=source.statements.find(statement=>statement.getText(source).includes("export async function withdrawInvite"))!;
 const auditCalls:ts.CallExpression[]=[];function inspect(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==="withAudit")auditCalls.push(node);ts.forEachChild(node,inspect);}inspect(wrapper);
 expect(auditCalls).toHaveLength(1);const preparation=auditCalls[0]!.arguments[1]!;expect(ts.isAwaitExpression(preparation)).toBe(true);expect(preparation.getText(source)).toBe("await prepareWithdrawalResult(form)");
 const prepare=source.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==="prepareWithdrawalResult") as ts.FunctionDeclaration;
 let callback:ts.Expression|undefined;function returned(node:ts.Node){if(node!==prepare && ts.isFunctionLike(node))return;if(ts.isReturnStatement(node)&&node.expression&&ts.isArrowFunction(node.expression))callback=node.expression;ts.forEachChild(node,returned);}returned(prepare);expect(callback).toBeDefined();
 expect(ts.isArrowFunction(callback!)).toBe(true);expect(callback!.getText(source)).not.toContain("execute(form)");expect(prepare.getText(source)).toContain("await execute(form)");
 expect(calls).toContain("createAuthorizedInvitationWithdrawal");expect(calls).toContain("createInvitationWithdrawalService");expect(calls).toContain("withAudit");
});

test("foreign request/action pairing cannot withdraw another company's invitation",async()=>{
 const selected=await arrange("group_admin"),foreign=await arrange("group_admin");
 selected.form.set("requestId",foreign.request);
 expect(await selected.execute(selected.form)).toEqual({ok:false,error:"conflict"});expect(selected.remoteCalls()).toBe(0);
 expect((await owner.query(`SELECT state FROM license_request WHERE (id=$1 AND company_id=$2) OR (id=$3 AND company_id=$4) ORDER BY id`,[selected.request,selected.company,foreign.request,foreign.company])).rows.map(row=>row.state)).toEqual(["invited","invited"]);
});


test("authorized withdrawal persists immutable human actor and note through unchanged reader into Acciones",async()=>{
 const selected=await arrange("group_admin"),foreign=await arrange("group_admin");
 const outcome=await selected.execute(selected.form);expect(outcome.ok).toBe(true);if(!outcome.ok)throw new Error("WITHDRAWAL_FAILED");
 expect((await owner.query(`SELECT observation.vendor_account_id,observation.provisioning_action_id,observation.operation,observation.phase,observation.classification,observation.summary FROM connector_call_observation observation JOIN provisioning_action action ON action.id=observation.provisioning_action_id JOIN license_request request ON request.id=action.request_id WHERE request.id=$1 AND request.company_id=$2 ORDER BY observation.summary->>'method',observation.phase`,[selected.request,selected.company])).rows).toEqual([
  {vendor_account_id:selected.account,provisioning_action_id:outcome.actionId,operation:"deprovision",phase:"requested",classification:null,summary:{endpoint_class:"invitations",method:"DELETE"}},
  {vendor_account_id:selected.account,provisioning_action_id:outcome.actionId,operation:"deprovision",phase:"succeeded",classification:"success",summary:{endpoint_class:"invitations",method:"DELETE",http_status:200,status_class:"success"}},
  {vendor_account_id:selected.account,provisioning_action_id:outcome.actionId,operation:"deprovision",phase:"requested",classification:null,summary:{endpoint_class:"invitations",method:"GET"}},
  {vendor_account_id:selected.account,provisioning_action_id:outcome.actionId,operation:"deprovision",phase:"succeeded",classification:"success",summary:{endpoint_class:"invitations",method:"GET",http_status:200,status_class:"success"}},
 ]);
 await owner.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,company_id,note,occurred_at) VALUES($1,'invitation.withdrawn','ProvisioningAction',$2,$3,'Foreign tenant note',$4)`,[foreign.actor,outcome.actionId,foreign.company,at]);
 await owner.query(`UPDATE user_account SET email='renamed@auth.test' WHERE id=$1`,[selected.actor]);
 expect(await selected.execute(selected.form)).toEqual(outcome);expect(selected.remoteCalls()).toBe(2);
 const authorization=await selected.entrypoints.loadCurrentLedgerAuthorization();
 const record=await createRequestReadRepository(selected.database,()=>at).detail(authorization!,selected.request);
 expect(record!.actions.find(action=>action.id===outcome.actionId)!.rawRequest).toMatchObject({actorUserId:selected.actor,actorLabel:selected.actor+"@auth.test",note:"Required withdrawal note",companyId:selected.company});
 expect(record!.audit.some(entry=>entry.note === "Foreign tenant note")).toBe(false);
 const history=en.requestHistory;
 const labels:RequestRecordLabels={...history,actionKind:{assign_sku:history.actionAssignSku,checklist:history.actionChecklist,invite:history.actionInvite,remove:history.actionRemove,withdraw_invite:history.actionWithdrawInvite},actionMode:{automated:history.actionAutomated,orchestration:history.actionOrchestration},actionStatus:{confirmed:history.actionConfirmed,failed:history.actionFailed,pending:history.actionPending,sent:history.actionSent,verification_failed:history.actionVerificationFailed,withdrawn:history.actionWithdrawn},retryProvisioning:en.orchestration.retryProvisioning,retryingProvisioning:en.orchestration.retryingProvisioning};
 const markup=renderToStaticMarkup(createElement(RequestRecord,{activeTab:"actions",isGroupAdmin:true,labels,locale:"en-US",statusLabels:getNotificationCatalog("en-US").status,record:record!}));
 const evidence=markup.match(/<div[^>]+data-testid="withdrawal_evidence"[^>]*>(.*?)<\/div>/)![1]!;
 expect(evidence).toContain(selected.actor+"@auth.test");expect(evidence).toContain("Required withdrawal note");expect(evidence).not.toContain("FORGED ACTOR");expect(evidence).not.toContain("Foreign tenant note");
});


async function invokeProduction(actor:string,form:FormData){
 const {encode}=await import(require.resolve("next-auth/jwt"));
 const token=await encode({secret:process.env.AUTH_SECRET!,salt:"authjs.session-token",token:{idpSubject:actor,displayName:"Verified fixture administrator"}});
 const {createRequestStoreForAPI}=require("next/dist/server/async-storage/request-store");const {createWorkStore}=require("next/dist/server/async-storage/work-store");const {IncrementalCache}=require("next/dist/server/lib/incremental-cache");
 const {workAsyncStorage}=require("next/dist/server/app-render/work-async-storage.external");const {workUnitAsyncStorage}=require("next/dist/server/app-render/work-unit-async-storage.external");
 const url=new URL("http://localhost:3000/excepciones"),request=new Request(url,{headers:{cookie:"authjs.session-token="+token,host:url.host}});
 const store=createRequestStoreForAPI(request,url,{tags:[],expirationsByCacheKind:new Map()});
 const incrementalCache=new IncrementalCache({dev:false,minimalMode:false,requestHeaders:{},getPrerenderManifest:()=>({version:4,routes:{},dynamicRoutes:{},notFoundRoutes:[],preview:{previewModeId:"us068-fixture"}})});
 const work=createWorkStore({page:"/excepciones/page",renderOpts:{supportsDynamicResponse:true,isDraftMode:false,isPossibleServerAction:true,incrementalCache},isPrefetchRequest:false,buildId:"us068-fixture",previouslyRevalidatedTags:[]});
 const outcome=await workAsyncStorage.run(work,()=>workUnitAsyncStorage.run(store,()=>withdrawInvite(form)));
 return {outcome,tags:work.pendingRevalidatedTags?.map((entry:{tag:string})=>entry.tag)??[]};
}
test("actual signed-session server action rejects unauthorized and invalid commands with trusted result auditing",async()=>{
 const selected=await arrange("group_admin"),denied=await arrange(null);
 selected.form.set("note","");expect(await invokeProduction(selected.actor,selected.form)).toEqual({outcome:{ok:false,error:"invalid"},tags:[]});
 expect(await invokeProduction(denied.actor,denied.form)).toEqual({outcome:{ok:false,error:"forbidden"},tags:[]});
 expect((await owner.query(`SELECT actor_user_id,entity_type,after FROM audit_log WHERE action='server_action.withdrawInvite' AND entity_id=$1`,[selected.request])).rows).toEqual([{actor_user_id:selected.actor,entity_type:"LicenseRequest",after:{ok:false,error:"invalid"}}]);
 expect((await owner.query(`SELECT actor_user_id,entity_type,after FROM audit_log WHERE action='server_action.withdrawInvite' AND entity_id=$1`,[denied.request])).rows).toEqual([{actor_user_id:denied.actor,entity_type:"LicenseRequest",after:{ok:false,error:"forbidden"}}]);expect(selected.remoteCalls()+denied.remoteCalls()).toBe(0);
});
test("actual signed-session action finalizes durable validated receipt and revalidates once without another DELETE",async()=>{
 const selected=await arrange("group_admin"),before=await productionSnapshot(selected),name="us068_action_"+selected.request.replaceAll("-","");
 await owner.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${selected.request}'::uuid AND NEW.kind='withdraw_invite' AND NEW.status='withdrawn' THEN RETURN NULL; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE UPDATE ON provisioning_action FOR EACH ROW EXECUTE FUNCTION ${name}();`);
 try{expect(await selected.execute(selected.form)).toEqual({ok:false,error:"ambiguous"});}finally{await owner.query(`DROP TRIGGER ${name} ON provisioning_action;DROP FUNCTION ${name}();`);}
 expect((await owner.query(`SELECT state FROM license_request WHERE id=$1`,[selected.request])).rows[0].state).toBe("invited");
 const result=await invokeProduction(selected.actor,selected.form);expect(result.outcome).toEqual({ok:true,requestId:selected.request,actionId:expect.any(String)});expect(result.tags).toEqual(["_N_T_/excepciones","_N_T_/solicitudes/"+selected.request]);expect((await productionSnapshot(selected)).available-before.available).toBe(1);
 expect((await invokeProduction(selected.actor,selected.form)).outcome).toEqual(result.outcome);expect(selected.remoteCalls()).toBe(2);
 expect((await owner.query(`SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1`,[selected.request])).rows[0].count).toBe(1);
 expect((await owner.query(`SELECT actor_user_id,note FROM audit_log WHERE company_id=$1 AND action='invitation.withdrawn'`,[selected.company])).rows).toEqual([{actor_user_id:selected.actor,note:"Required withdrawal note"}]);
 expect((await owner.query(`SELECT actor_user_id,after FROM audit_log WHERE entity_id=$1 AND action='server_action.withdrawInvite' AND after->>'ok'='true'`,[selected.request])).rows).toEqual([{actor_user_id:selected.actor,after:result.outcome},{actor_user_id:selected.actor,after:result.outcome}]);
});


async function productionSnapshot(selected:Awaited<ReturnType<typeof arrange>>){
 const [counts]=await listCurrentSeatPoolCounts(owner,{operatingDate:"2026-10-02",asOf:at,vendorAccountId:selected.account});
 return {available:counts.purchased-counts.assigned-counts.pendingInvites,request:(await owner.query(`SELECT state,license_assignment_id FROM license_request WHERE id=$1 AND company_id=$2`,[selected.request,selected.company])).rows,assignments:(await owner.query(`SELECT id,ended_on FROM license_assignment WHERE company_id=$1 AND source_request_id=$2`,[selected.company,selected.request])).rows};
}
test.each(["missing-kek","unsupported"])("actual signed fresh %s failure retains reservation, intent and trusted result audit without network",async(kind)=>{
 const selected=await arrange("group_admin"),before=await productionSnapshot(selected),savedKek=process.env.LEDGER_CREDENTIAL_KEK_FILE;
 if(kind === "unsupported")await owner.query(`UPDATE vendor SET provisioning_protocol='none' WHERE id=$1`,[selected.vendor]);
 delete process.env.LEDGER_CREDENTIAL_KEK_FILE;
 const network=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{throw new Error("UNEXPECTED_PROVIDER_NETWORK");});
 try{
  expect(await invokeProduction(selected.actor,selected.form)).toEqual({outcome:{ok:false,error:kind === "unsupported"?"unsupported":"ambiguous"},tags:[]});
  expect(await productionSnapshot(selected)).toEqual(before);expect(network).not.toHaveBeenCalled();
  expect((await owner.query(`SELECT status,raw_response,raw_request FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[selected.request])).rows).toEqual([{status:"pending",raw_response:null,raw_request:expect.objectContaining({actorUserId:selected.actor,companyId:selected.company,note:"Required withdrawal note"})}]);
  expect((await invokeProduction(selected.actor,selected.form)).outcome).toEqual({ok:false,error:"ambiguous"});expect(network).not.toHaveBeenCalled();expect(await productionSnapshot(selected)).toEqual(before);
  expect((await owner.query(`SELECT actor_user_id,entity_type,after FROM audit_log WHERE entity_id=$1 AND action='server_action.withdrawInvite' ORDER BY after->>'error'`,[selected.request])).rows).toEqual([{actor_user_id:selected.actor,entity_type:"LicenseRequest",after:{ok:false,error:"ambiguous"}},{actor_user_id:selected.actor,entity_type:"LicenseRequest",after:{ok:false,error:kind === "unsupported"?"unsupported":"ambiguous"}}]);
  expect((await owner.query(`SELECT id FROM request_transition WHERE request_id=$1`,[selected.request])).rows).toEqual([]);
 }finally{network.mockRestore();if(savedKek===undefined)delete process.env.LEDGER_CREDENTIAL_KEK_FILE;else process.env.LEDGER_CREDENTIAL_KEK_FILE=savedKek;}
});


test("actual signed action validates each missing or invalid command field before provider composition",async()=>{
 const selected=await arrange("group_admin"),before=await productionSnapshot(selected),network=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{throw new Error("UNEXPECTED_PROVIDER_NETWORK");});let commands=0;
 try{
  for(const field of ["requestId","actionId","commandId","note"]){
   for(const value of [undefined,field==='note'?"   ":"invalid",...(field==='note'?["x".repeat(2001)]:[])]){
    const form=new FormData();for(const [key,entry] of selected.form)form.set(key,entry);if(value===undefined)form.delete(field);else form.set(field,value);
    expect(await invokeProduction(selected.actor,form)).toEqual({outcome:{ok:false,error:"invalid"},tags:[]});commands++;
   }
  }
  expect(await productionSnapshot(selected)).toEqual(before);expect(network).not.toHaveBeenCalled();
  expect((await owner.query(`SELECT actor_user_id,entity_type,after FROM audit_log WHERE actor_user_id=$1 AND action='server_action.withdrawInvite'`,[selected.actor])).rows).toEqual(Array.from({length:commands},()=>({actor_user_id:selected.actor,entity_type:"LicenseRequest",after:{ok:false,error:"invalid"}})));
  expect((await owner.query(`SELECT id FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[selected.request])).rows).toEqual([]);
 }finally{network.mockRestore();}
});
