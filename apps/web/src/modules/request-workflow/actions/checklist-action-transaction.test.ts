import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { expect, it } from "vitest";
import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import { createAuthorizationRepository } from "../../identity-access/authorization";
import { createPeopleRepository } from "../../org-registry/repository";
import { createChecklistActionService } from "./checklist-action-transaction";

it("the production removal wrapper preserves register on refusal/unconfirmed replay and audits confirmation once",async()=>{
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
  const removal=await createPeopleRepository(database).startOffboarding(authorization,{personId:person,requestId:request,endReason:"left_company",note:"Actual wrapper removal"},at);
  const actionId=removal.provisioningActionIds[0]!;
  const unavailable=createChecklistActionService(database,{loadAuthorization:()=>authorizationRepository.load({subject:null}),now:()=>at});
  expect(await unavailable.confirmChecklistDone({actionId,confirmationId:"unauthorized"})).toEqual({ok:false,error:"forbidden"});
  const service=createChecklistActionService(database,{loadAuthorization:()=>authorizationRepository.load({subject:"us075-wrapper-admin"}),now:()=>at});
  const failure={actionId,failureId:"attempt-1",reason:"Vendor removal not yet complete"};
  expect(await service.markChecklistNotDone(failure)).toEqual({ok:true,requestId:request});
  expect(await service.markChecklistNotDone(failure)).toEqual({ok:true,requestId:request});
  expect(await service.markChecklistNotDone({...failure,reason:"Conflicting attempt"})).toEqual({ok:false,error:"conflict"});
  expect((await owner.query("SELECT ended_on,end_reason FROM license_assignment WHERE id=$1",[assignment])).rows).toEqual([{ended_on:null,end_reason:null}]);
  expect(await service.confirmChecklistDone({actionId,confirmationId:"done"})).toEqual({ok:true,requestId:request});
  expect(await service.confirmChecklistDone({actionId,confirmationId:"different-done"})).toEqual({ok:true,requestId:request});
  expect((await owner.query("SELECT request.state,action.status,action.failure_reason,assignment.ended_on::text,assignment.end_reason FROM license_request request JOIN provisioning_action action ON action.request_id=request.id JOIN license_assignment assignment ON assignment.id=request.license_assignment_id WHERE request.id=$1",[request])).rows).toEqual([{state:"deprovisioned",status:"confirmed",failure_reason:null,ended_on:"2026-07-28",end_reason:"left_company"}]);
  expect((await owner.query("SELECT action,count(*)::int AS count FROM audit_log WHERE entity_id=$1 AND action IN ('offboarding.removal_confirmed','offboarding.removal_unconfirmed','server_action.confirmChecklistDone','server_action.markChecklistNotDone') GROUP BY action ORDER BY action",[actionId])).rows).toEqual([{action:"offboarding.removal_confirmed",count:1},{action:"offboarding.removal_unconfirmed",count:1}]);
 }finally{await pool?.end();await owner?.end();await fixture.stop();}
},120_000);
