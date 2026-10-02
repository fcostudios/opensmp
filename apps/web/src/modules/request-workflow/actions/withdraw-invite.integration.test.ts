import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import ts from "typescript";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
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
const at=new Date("2026-10-02T15:00:00Z");
beforeAll(async()=>{fixture=await createPostgresFixture();await fixture.migrate();owner=await fixture.connectAsOwner();pool=new pg.Pool({connectionString:fixture.ownerUrl});},30000);
afterAll(async()=>{await pool?.end();await owner?.end();await fixture?.stop();});
async function arrange(role:"group_admin"|null) {
 const actor=randomUUID(),company=randomUUID(),vendor=randomUUID(),account=randomUUID(),license=randomUUID(),person=randomUUID(),request=randomUUID(),action=randomUUID();
 await owner.query(`INSERT INTO user_account(id,email,idp_subject,global_role,status,created_at) VALUES($1,$2,$1::uuid::text,$3,'active',$4)`,[actor,actor+"@auth.test",role,at]);
 await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,$1::uuid::text,$1::uuid::text,'internal','active',$2,$3)`,[company,at,actor]);
 await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,$1::uuid::text,'api','rest',true,true,false,false,'email','active',$2,$3)`,[vendor,at,actor]);
 await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,$1::uuid::text,'automated',1,'active',$3,$4)`,[account,vendor,at,actor]);
 await owner.query(`INSERT INTO license_type(id,vendor_id,name,unit,status,created_at,created_by) VALUES($1,$2,$1::uuid::text,'seat','active',$3,$4)`,[license,vendor,at,actor]);
 await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,$2,'Person',$3,'active',$4,$5)`,[person,person+"@auth.test",company,at,actor]);
 await owner.query(`INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by) VALUES($1,$1::uuid::text,$2,$3,$4,$5,'invited','Need',$6,$7)`,[request,person,company,account,license,at,actor]);
 await owner.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,sent_at,created_at) VALUES($1,$2,$3,'invite','automated','sent','invite-pinned',$4,$4)`,[action,request,account,at]);
 const clock={now:()=>at.getTime()},sleep=async()=>undefined;
 let remoteCalls=0;
 const connector=createAnthropicConnector({credentialsFor:async()=>[
 {vendorAccountId:account,kind:"admin_scoped",secret:"admin",status:"active",health:"ok"},{vendorAccountId:account,kind:"analytics",secret:"analytics",status:"active",health:"ok"},
 ],observationSessionFor:async(operation)=>createConnectorCallObservationSession({vendorAccountId:account,provisioningActionId:null,operation:operation.operation,clock:()=>at,randomId:randomUUID,append:async()=>undefined}),requestDependencies:{clock,sleep,limiter:createAnthropicRateLimiter({clock,sleep}),transport:async(input)=>{
 remoteCalls++;return new Response(JSON.stringify(input.method === "DELETE"?{id:"invite-pinned",type:"invite_deleted"}:{data:[{id:"invite-pinned",type:"invite",email:"selected@example.test",status:"pending"}],has_more:false,first_id:"invite-pinned",last_id:"invite-pinned"}),{headers:{"content-type":"application/json"}});
 }}});
 const database=drizzle(pool,{schema});
 const entrypoints=createServerAuthorizationEntrypoints({loadSession:async()=>({user:{idpSubject:actor}}),repository:createAuthorizationRepository(database)});
 const execute=createAuthorizedInvitationWithdrawal({pool,loadAuthorization:entrypoints.loadCurrentLedgerAuthorization,service:createInvitationWithdrawalService({pool,now:()=>at,assertLegalTransition,connectorFor:async()=>connector}),recordOutcome:async(userId,requestId,outcome)=>{await withAudit(database,async()=>({value:outcome,audit:{actorUserId:userId,action:"server_action.withdrawInvite",entityType:"LicenseRequest",entityId:requestId??request,companyId:company,note:null,before:null,after:outcome}}),{occurredAt:at});}});
 const form=new FormData();form.set("requestId",request);form.set("actionId",action);form.set("commandId",action);form.set("note","Required withdrawal note");form.set("actorUserId",randomUUID());form.set("companyId",randomUUID());
 return {execute,form,actor,company,request,action,remoteCalls:()=>remoteCalls};
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
 expect(calls).toContain("createAuthorizedInvitationWithdrawal");expect(calls).toContain("createInvitationWithdrawalService");expect(calls).toContain("withAudit");
});

test("foreign request/action pairing cannot withdraw another company's invitation",async()=>{
 const selected=await arrange("group_admin"),foreign=await arrange("group_admin");
 selected.form.set("requestId",foreign.request);
 expect(await selected.execute(selected.form)).toEqual({ok:false,error:"conflict"});expect(selected.remoteCalls()).toBe(0);
 expect((await owner.query(`SELECT state FROM license_request WHERE (id=$1 AND company_id=$2) OR (id=$3 AND company_id=$4) ORDER BY id`,[selected.request,selected.company,foreign.request,foreign.company])).rows.map(row=>row.state)).toEqual(["invited","invited"]);
});
