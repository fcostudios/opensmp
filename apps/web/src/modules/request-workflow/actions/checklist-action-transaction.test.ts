import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { expect, it } from "vitest";
import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import { createAuthorizationRepository } from "../../identity-access/authorization";
import { createPeopleRepository } from "../../org-registry/repository";
import { createChecklistActionService } from "./checklist-action-transaction";
import { createOrchestrationOperations } from "../orchestration";

it.each([
  ["left_company", "remove"], ["inactive", "remove"],
  ["left_company", "checklist"], ["inactive", "checklist"],
] as const)("the production %s/%s removal wrapper preserves refusal/retry/replay and exact atomic receipts",async(endReason,kind)=>{
 const fixture=await createPostgresFixture();
 let pool:pg.Pool|undefined;
 let owner:pg.Client|undefined;
 try {
  await fixture.migrate();
  owner=await fixture.connectAsOwner();
  pool=new pg.Pool({connectionString:fixture.appUrl});
  const database=drizzle(pool,{schema});
  const id=(suffix:string)=>`75000000-0000-4000-8000-${suffix.padStart(12,"0")}`;
  const admin=id("1"),company=id("2"),person=id("3"),vendor=id("4"),account=id("5"),license=id("6"),request=id("7"),assignment=id("8");
  const at=new Date("2026-07-28T15:00:00Z");
  await owner.query("INSERT INTO user_account(id,email,idp_subject,global_role,ui_language,status,created_at) VALUES($1,'wrapper-admin@example.test','us075-wrapper-admin','group_admin','es','active',$2)",[admin,at]);
  await owner.query("INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'Wrapper tenant','US075-WRAPPER','internal','active',$2,$3)",[company,at,admin]);
  await owner.query("INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,'wrapper-person@example.test','Wrapper Person',$2,'active',$3,$4)",[person,company,at,admin]);
  await owner.query("INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,'Wrapper vendor','orchestration','none',false,false,false,false,'email','active',$2,$3)",[vendor,at,admin]);
  await owner.query("INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Wrapper org','orchestration',0,'active',$3,$4)",[account,vendor,at,admin]);
  await owner.query("INSERT INTO license_type(id,vendor_id,name,unit,status,created_at,created_by) VALUES($1,$2,'Wrapper seat','seat','active',$3,$4)",[license,vendor,at,admin]);
  await owner.query("INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by) VALUES($1,'REQ-US075-WRAPPER',$2,$3,$4,$5,'active','Wrapper oracle',$6,$7)",[request,person,company,account,license,at,admin]);
  await owner.query("INSERT INTO license_assignment(id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_request_id,source_kind,created_at,created_by) VALUES($1,$2,$3,$4,$5,'2026-07-28',$6,'request',$7,$8)",[assignment,person,company,account,license,request,at,admin]);
  await owner.query("UPDATE license_request SET license_assignment_id=$1 WHERE id=$2",[assignment,request]);
  const authorizationRepository=createAuthorizationRepository(database);
  const authorization=await authorizationRepository.load({subject:"us075-wrapper-admin"});
  if(!authorization)throw new Error("Seeded administrator unavailable");
  const removal=await createPeopleRepository(database).startOffboarding(authorization,{personId:person,requestId:request,endReason,note:"Actual wrapper removal"},at);
  const actionId=removal.provisioningActionIds[0]!;
  if(kind==="checklist") await owner.query("UPDATE provisioning_action SET kind='checklist' WHERE id=$1",[actionId]);
  const operations=createOrchestrationOperations(database,{now:()=>at});
  expect(await operations.pendingChecklist(authorization,request)).toMatchObject({id:actionId,status:"pending",rawRequest:{context:{endReason,assignmentIds:[assignment],requestId:request}}});
  await owner.query("INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'Foreign wrapper tenant','US087-FOREIGN','external','active',$2,$3)",[id("20"),at,admin]);
  for(const [holder,tenant,seat] of [[id("21"),company,id("31")],[id("22"),id("20"),id("32")]]){
    await owner.query("INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,$2,'Unrelated wrapper holder',$3,'active',$4,$5)",[holder,`${holder}@wrapper.test`,tenant,at,admin]);
    await owner.query("INSERT INTO license_assignment(id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_kind,created_at,created_by) VALUES($1,$2,$3,$4,$5,'2026-07-28','import',$6,$7)",[seat,holder,tenant,account,license,at,admin]);
  }
  await owner.query("INSERT INTO vendor_account_capacity(vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by) VALUES($1,$2,10,'2026-01-01',$3,$4)",[account,license,at,admin]);
  async function acceptedSnapshot(){
    const facts=[];
    for(const table of ["license_assignment","license_request","provisioning_action","request_transition","person","vendor_account","vendor_account_capacity","lifecycle_notification","lifecycle_notification_delivery"]){
      facts.push({table,rows:(await owner!.query(`SELECT to_jsonb(record) AS fact FROM ${table} record ORDER BY to_jsonb(record)::text`)).rows});
    }
    facts.push({table:"audit_log",rows:(await owner!.query("SELECT to_jsonb(record) AS fact FROM audit_log record WHERE action NOT LIKE 'server_action.%' AND action<>'authorization.denied' ORDER BY to_jsonb(record)::text")).rows});
    return facts;
  }
  const noRemovalSideEffects=(await acceptedSnapshot()).filter(row=>["person","vendor_account","vendor_account_capacity"].includes(row.table));
  const originallyOpen=await acceptedSnapshot();
  await owner.query("INSERT INTO user_account(id,email,idp_subject,global_role,ui_language,status,created_at) VALUES($1,'wrapper-finance@example.test','us075-wrapper-finance','central_finance','es','active',$2)",[id("9"),at]);
  const unavailable=createChecklistActionService(database,{loadAuthorization:()=>authorizationRepository.load({subject:null}),now:()=>at});
  expect(await unavailable.confirmChecklistDone({actionId,confirmationId:"unauthorized"})).toEqual({ok:false,error:"forbidden"});
  const deniedFailure={actionId,failureId:"unauthorized-attempt",reason:"Unauthorized removal attempt"};
  expect(await unavailable.markChecklistNotDone(deniedFailure)).toEqual({ok:false,error:"forbidden"});
  const finance=createChecklistActionService(database,{loadAuthorization:()=>authorizationRepository.load({subject:"us075-wrapper-finance"}),now:()=>at});
  expect(await finance.confirmChecklistDone({actionId,confirmationId:"finance-denied"})).toEqual({ok:false,error:"forbidden"});
  expect(await finance.markChecklistNotDone(deniedFailure)).toEqual({ok:false,error:"forbidden"});
  expect((await owner.query("SELECT actor_user_id::text,action,entity_type,entity_id::text,company_id,note,before,after,occurred_at FROM audit_log WHERE action='authorization.denied' ORDER BY actor_user_id NULLS FIRST,after->>'capability'",[])).rows).toEqual([null,null,id("9"),id("9")].map((actor,index)=>({actor_user_id:actor,action:"authorization.denied",entity_type:"ProvisioningAction",entity_id:actionId,company_id:null,note:null,before:null,after:{capability:index%2===0?"orchestration:confirm":"orchestration:fail",errorCode:"capability_forbidden"},occurred_at:at})));
  expect((await owner.query("SELECT request.state,action.status,action.failure_reason,assignment.ended_on,assignment.end_reason FROM license_request request JOIN provisioning_action action ON action.request_id=request.id JOIN license_assignment assignment ON assignment.id=request.license_assignment_id WHERE request.id=$1",[request])).rows).toEqual([{state:"offboarding",status:"pending",failure_reason:null,ended_on:null,end_reason:null}]);
  expect((await owner.query("SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1",[request])).rows).toEqual([{count:1}]);
  const service=createChecklistActionService(database,{loadAuthorization:()=>authorizationRepository.load({subject:"us075-wrapper-admin"}),now:()=>at});
  for(const input of [{actionId,confirmationId:" "},{actionId,confirmationId:"x".repeat(201)},{actionId:"bad",confirmationId:"valid"}]){
    expect(await service.confirmChecklistDone(input)).toEqual({ok:false,error:"invalid"});
    expect(await acceptedSnapshot()).toEqual(originallyOpen);
  }
  for(const input of [{actionId,failureId:" ",reason:"reason"},{actionId,failureId:"id",reason:"   "}]){
    expect(await service.markChecklistNotDone(input)).toEqual({ok:false,error:"invalid"});
    expect(await acceptedSnapshot()).toEqual(originallyOpen);
  }
  const originalRaw=(await owner.query("SELECT raw_request FROM provisioning_action WHERE id=$1",[actionId])).rows[0].raw_request;
  await owner.query("UPDATE provisioning_action SET raw_request=$2 WHERE id=$1",[actionId,{...originalRaw,context:{...originalRaw.context,endReason:"reallocated"}}]);
  expect(await service.confirmChecklistDone({actionId,confirmationId:"invalid-context"})).toEqual({ok:false,error:"conflict"});
  expect((await owner.query("SELECT actor_user_id::text,action,entity_type,entity_id::text,company_id,note,before,after,occurred_at FROM audit_log WHERE entity_id=$1 AND action='server_action.confirmChecklistDone' AND after->>'errorCode'='conflict'",[actionId])).rows).toEqual([{actor_user_id:admin,action:"server_action.confirmChecklistDone",entity_type:"ProvisioningAction",entity_id:actionId,company_id:null,note:null,before:null,after:{accepted:false,errorCode:"conflict"},occurred_at:at}]);
  await owner.query("UPDATE provisioning_action SET raw_request=$2 WHERE id=$1",[actionId,originalRaw]);
  const failure={actionId,failureId:"  attempt-1  ",reason:"  Vendor removal not yet complete  "};
  expect(await service.markChecklistNotDone(failure)).toEqual({ok:true,requestId:request});
  expect((await owner.query("SELECT actor_user_id::text,action,entity_type,entity_id::text,company_id::text,note,before,after,occurred_at FROM audit_log WHERE entity_id=$1 AND action='offboarding.removal_unconfirmed'",[actionId])).rows).toEqual([{actor_user_id:admin,action:"offboarding.removal_unconfirmed",entity_type:"ProvisioningAction",entity_id:actionId,company_id:company,note:null,before:null,after:{failureId:"attempt-1",reason:"Vendor removal not yet complete"},occurred_at:at}]);

  expect(await service.markChecklistNotDone({...failure,failureId:"attempt-1",reason:"Vendor removal not yet complete"})).toEqual({ok:true,requestId:request});
  expect(await service.markChecklistNotDone({...failure,reason:"Conflicting attempt"})).toEqual({ok:false,error:"conflict"});
  expect((await owner.query("SELECT ended_on,end_reason FROM license_assignment WHERE id=$1",[assignment])).rows).toEqual([{ended_on:null,end_reason:null}]);
  const attempts=await Promise.all([
    service.markChecklistNotDone({actionId,failureId:"attempt-2",reason:"Vendor removal not yet complete"}),
    service.markChecklistNotDone({actionId,failureId:"attempt-3",reason:"Vendor removal not yet complete"}),
  ]);
  expect(attempts).toEqual([{ok:true,requestId:request},{ok:true,requestId:request}]);
  expect((await owner.query("SELECT after FROM audit_log WHERE entity_id=$1 AND action='offboarding.removal_unconfirmed' ORDER BY after->>'failureId'",[actionId])).rows)
    .toEqual(["attempt-1","attempt-2","attempt-3"].map(failureId=>({after:{failureId,reason:"Vendor removal not yet complete"}})));
  expect(await operations.pendingChecklist(authorization,request)).toMatchObject({id:actionId,status:"pending",rawRequest:{context:{endReason,assignmentIds:[assignment],requestId:request}}});
  const priorAttempt=await acceptedSnapshot();
  await owner.query("CREATE FUNCTION us087_corrupt_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='offboarding.removal_unconfirmed' THEN NEW.after='{}'::jsonb; END IF; RETURN NEW; END $$");
  await owner.query("CREATE TRIGGER us087_corrupt_attempt BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION us087_corrupt_attempt()");
  try{await expect(service.markChecklistNotDone({actionId,failureId:"missing-attempt-receipt",reason:"Different attempted reason"})).rejects.toThrow(/^RECORDED_AUDIT_NOT_FOUND$/);}
  finally{await owner.query("DROP TRIGGER us087_corrupt_attempt ON audit_log; DROP FUNCTION us087_corrupt_attempt()");}
  expect(await acceptedSnapshot()).toEqual(priorAttempt);
  await owner.query("CREATE FUNCTION us075_corrupt_completion_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='offboarding.removal_confirmed' THEN NEW.after='{}'::jsonb; END IF; RETURN NEW; END $$");
  await owner.query("CREATE TRIGGER us075_corrupt_completion_receipt BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION us075_corrupt_completion_receipt()");
  const beforeReceipt=await acceptedSnapshot();
  try { await expect(service.confirmChecklistDone({actionId,confirmationId:"missing-receipt"})).rejects.toThrow(/^RECORDED_AUDIT_NOT_FOUND$/); }
  finally { await owner.query("DROP TRIGGER us075_corrupt_completion_receipt ON audit_log; DROP FUNCTION us075_corrupt_completion_receipt()"); }
  expect((await owner.query("SELECT request.state,action.status,action.failure_reason,assignment.ended_on,assignment.end_reason FROM license_request request JOIN provisioning_action action ON action.request_id=request.id JOIN license_assignment assignment ON assignment.id=request.license_assignment_id WHERE request.id=$1",[request])).rows).toEqual([{state:"offboarding",status:"pending",failure_reason:failure.reason.trim(),ended_on:null,end_reason:null}]);
  expect((await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE entity_id=$1 AND action='offboarding.removal_confirmed'",[actionId])).rows).toEqual([{count:0}]);
  expect(await acceptedSnapshot()).toEqual(beforeReceipt);
  // Corrupt lineage only after the real nested operation has written its genuine audit.
  await owner.query("INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by) VALUES($1,'REQ-US087-IDENTITY',$2,$3,$4,$5,'offboarding','Receipt identity fault',$6,$7)",[id("40"),person,company,account,license,at,admin]);
  for(const [operation,event] of [["confirm","offboarding.removal_confirmed"],["fail","offboarding.removal_unconfirmed"]]){
    await owner.query(`CREATE FUNCTION us087_corrupt_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN IF NEW.action='${event}' THEN UPDATE provisioning_action SET request_id='${id("40")}' WHERE id=NEW.entity_id; END IF; RETURN NEW; END $$`);
    await owner.query("CREATE TRIGGER us087_corrupt_identity BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION us087_corrupt_identity()");
    const beforeIdentity=await acceptedSnapshot();
    try{
      const call=operation==="confirm"?service.confirmChecklistDone({actionId,confirmationId:"identity-fault"}):service.markChecklistNotDone({actionId,failureId:"identity-fault",reason:"Identity failure reason"});
      await expect(call).rejects.toThrow(/^OFFBOARDING_AUDIT_IDENTITY_MISSING$/);
    }finally{await owner.query("DROP TRIGGER us087_corrupt_identity ON audit_log; DROP FUNCTION us087_corrupt_identity()");}
    expect(await acceptedSnapshot()).toEqual(beforeIdentity);
  }
  await owner.query("CREATE FUNCTION us087_reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='offboarding.removal_confirmed' THEN RAISE EXCEPTION 'forced wrapper completion audit failure'; END IF; RETURN NEW; END $$");
  await owner.query("CREATE TRIGGER us087_reject_completion BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION us087_reject_completion()");
  const beforeAudit=await acceptedSnapshot();
  try{expect(await service.confirmChecklistDone({actionId,confirmationId:"audit-fault"})).toEqual({ok:false,error:"invalid"});}
  finally{await owner.query("DROP TRIGGER us087_reject_completion ON audit_log; DROP FUNCTION us087_reject_completion()");}
  expect(await acceptedSnapshot()).toEqual(beforeAudit);
  expect(await service.confirmChecklistDone({actionId,confirmationId:"done"})).toEqual({ok:true,requestId:request});
  expect(await service.confirmChecklistDone({actionId,confirmationId:"different-done"})).toEqual({ok:true,requestId:request});
  await owner.query("INSERT INTO user_account(id,email,idp_subject,global_role,ui_language,status,created_at) VALUES($1,'wrapper-admin2@example.test','us075-wrapper-admin2','group_admin','es','active',$2)",[id("10"),at]);
  const secondAdmin=createChecklistActionService(database,{loadAuthorization:()=>authorizationRepository.load({subject:"us075-wrapper-admin2"}),now:()=>new Date("2026-07-30T15:00:00Z")});
  expect(await secondAdmin.confirmChecklistDone({actionId,confirmationId:"second-admin-replay"})).toEqual({ok:true,requestId:request});
  expect((await owner.query("SELECT actor_user_id::text,company_id::text,occurred_at,after FROM audit_log WHERE entity_id=$1 AND action='offboarding.removal_confirmed'",[actionId])).rows).toEqual([{actor_user_id:admin,company_id:company,occurred_at:at,after:{requestId:request,assignmentIds:[assignment],endedOn:"2026-07-28",endReason,confirmedAt:at.toISOString(),confirmationId:"done",replayed:false}}]);
  expect((await owner.query("SELECT request.state,action.status,action.failure_reason,assignment.ended_on::text,assignment.end_reason FROM license_request request JOIN provisioning_action action ON action.request_id=request.id JOIN license_assignment assignment ON assignment.id=request.license_assignment_id WHERE request.id=$1",[request])).rows).toEqual([{state:"deprovisioned",status:"confirmed",failure_reason:null,ended_on:"2026-07-28",end_reason:endReason}]);
  expect((await owner.query("SELECT action,count(*)::int AS count FROM audit_log WHERE entity_id=$1 AND action IN ('offboarding.removal_confirmed','offboarding.removal_unconfirmed','server_action.confirmChecklistDone','server_action.markChecklistNotDone') AND (action NOT LIKE 'server_action.%' OR after->>'accepted'='true') GROUP BY action ORDER BY action",[actionId])).rows).toEqual([{action:"offboarding.removal_confirmed",count:1},{action:"offboarding.removal_unconfirmed",count:3}]);
  expect((await owner.query("SELECT action,entity_type,after FROM audit_log WHERE entity_id=$1 AND action LIKE 'server_action.%' AND after->>'accepted'='false' AND after->>'errorCode'='conflict' ORDER BY action",[actionId])).rows).toEqual([{action:"server_action.confirmChecklistDone",entity_type:"ProvisioningAction",after:{accepted:false,errorCode:"conflict"}},{action:"server_action.markChecklistNotDone",entity_type:"ProvisioningAction",after:{accepted:false,errorCode:"conflict"}}]);
  expect(await operations.pendingChecklist(authorization,request)).toBeNull();
  expect((await acceptedSnapshot()).filter(row=>["person","vendor_account","vendor_account_capacity"].includes(row.table))).toEqual(noRemovalSideEffects);
  expect((await owner.query("SELECT id::text,ended_on,end_reason FROM license_assignment WHERE id IN ($1,$2) ORDER BY id",[id("31"),id("32")])).rows)
    .toEqual([{id:id("31"),ended_on:null,end_reason:null},{id:id("32"),ended_on:null,end_reason:null}]);
  expect((await owner.query("SELECT to_state::text FROM request_transition WHERE request_id=$1 ORDER BY occurred_at,id",[request])).rows.map(row=>row.to_state).sort()).toEqual(["deprovisioned","offboarding"]);
  expect((await owner.query("SELECT count(*)::int AS count FROM alert_event",[])).rows).toEqual([{count:0}]);
 }finally{await pool?.end();await owner?.end();await fixture.stop();}
},120_000);
