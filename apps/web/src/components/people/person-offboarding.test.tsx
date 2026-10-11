// @vitest-environment jsdom
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import { createPeopleRepository } from "../../modules/org-registry/repository";
import { executeOffboardingIntent } from "../../modules/org-registry/people-action-service";
import { createAuthorizationRepository } from "../../modules/identity-access/authorization";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test } from "vitest";
import esMessages from "../../../messages/es-EC.json";
import { startOffboarding } from "../../modules/org-registry/actions/people";
import { PersonOffboarding, type PersonOffboardingLabels } from "./person-offboarding";
const personId="00000000-0000-0000-0000-000000000401";
const requestId="00000000-0000-0000-0000-000000000402";
const otherRequest="00000000-0000-0000-0000-000000000403";
const labels=esMessages.people as PersonOffboardingLabels;
afterEach(cleanup);
function view(props: {fixedRequestId?:string;targets?:readonly {requestId:string;label:string}[]}) {
 return render(<NextIntlClientProvider locale="es-EC" messages={esMessages}><PersonOffboarding action={startOffboarding} labels={labels} personId={personId} {...props}/></NextIntlClientProvider>);
}
describe("PersonOffboarding authorized targets",()=>{
 test("requires an explicit anchored choice and keeps only removal reasons",async()=>{
  const user=userEvent.setup();
  view({targets:[{requestId,label:"Org A · Seat A"},{requestId:otherRequest,label:"Org B · Seat B"}]});
  await user.click(screen.getByTestId("btn_start_offboarding"));
  const confirm=screen.getByTestId("btn_confirm_offboarding") as HTMLButtonElement;
  await user.type(screen.getByLabelText(labels.offboardingNote),"Remove selected seat");
  expect(confirm.disabled).toBe(true);
  const select=screen.getByTestId("offboarding_target") as HTMLSelectElement;
  expect(select.name).toBe("requestId");
  expect(Array.from(select.options).map(option=>option.value)).toEqual(["",requestId,otherRequest]);
  await user.selectOptions(select,otherRequest);
  expect(select.value).toBe(otherRequest);
  expect(confirm.disabled).toBe(false);
  const reasons=screen.getByTestId("end_reason") as HTMLSelectElement;
  expect(Array.from(reasons.options).map(option=>option.value)).toEqual(["left_company","inactive"]);
  await user.selectOptions(reasons,"inactive");
  expect(reasons.value).toBe("inactive");
  await user.click(screen.getByTestId("btn_cancel_offboarding"));
  expect((screen.getByTestId("modal_offboarding") as HTMLDetailsElement).open).toBe(false);
  expect(document.activeElement).toBe(screen.getByTestId("btn_start_offboarding"));
 });
 test("binds a fixed request without selecting a different seat",async()=>{
  const user=userEvent.setup();view({fixedRequestId:requestId});
  await user.click(screen.getByTestId("btn_start_offboarding"));
  expect((screen.getByTestId("offboarding_request_id") as HTMLInputElement).value).toBe(requestId);
  expect(screen.queryByTestId("offboarding_target")).toBeNull();
  expect((screen.getByTestId("offboarding_person_id") as HTMLInputElement).value).toBe(personId);
  await user.type(screen.getByLabelText(labels.offboardingNote),"Confirmed removal");
  expect((screen.getByTestId("btn_confirm_offboarding") as HTMLButtonElement).disabled).toBe(false);
 });
 test("an empty authorized target projection cannot submit or claim completion",async()=>{
  const user=userEvent.setup();view({targets:[]});
  await user.click(screen.getByTestId("btn_start_offboarding"));
  await user.type(screen.getByLabelText(labels.offboardingNote),"Imported seat has no request");
  expect((screen.getByTestId("btn_confirm_offboarding") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(labels.offboardingUnavailable)).toBeTruthy();
  expect(screen.queryByText(labels.offboardingSuccess)).toBeNull();
 });
});

test("rendered discovery and first submission execute the real authorized transaction for only the selected seat",async()=>{
 const fixture=await createPostgresFixture();
 let pool:pg.Pool|undefined;
 let owner:pg.Client|undefined;
 try {
  await fixture.migrate();owner=await fixture.connectAsOwner();pool=new pg.Pool({connectionString:fixture.appUrl});
  const database=drizzle(pool,{schema});
  const id=(suffix:string)=>`76000000-0000-4000-8000-${suffix.padStart(12,"0")}`;
  const admin=id("1"),company=id("2"),person=id("3"),vendor=id("4"),account=id("5");
  const licenses=[id("6"),id("7")],requests=[id("8"),id("9")],assignments=[id("10"),id("11")];
  const at=new Date("2026-07-28T15:00:00Z");
  await owner.query("INSERT INTO user_account(id,email,idp_subject,global_role,ui_language,status,created_at) VALUES($1,'ui-admin@example.test','us075-ui-admin','group_admin','es','active',$2)",[admin,at]);
  await owner.query("INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'UI tenant','US075-UI','internal','active',$2,$3)",[company,at,admin]);
  await owner.query("INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,'ui-person@example.test','UI Person',$2,'active',$3,$4)",[person,company,at,admin]);
  await owner.query("INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,'UI vendor','orchestration','none',false,false,false,false,'email','active',$2,$3)",[vendor,at,admin]);
  await owner.query("INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'UI account','orchestration',0,'active',$3,$4)",[account,vendor,at,admin]);
  for(let index=0;index<2;index++){
   await owner.query("INSERT INTO license_type(id,vendor_id,name,unit,status,created_at,created_by) VALUES($1,$2,$3,'seat','active',$4,$5)",[licenses[index],vendor,`UI seat ${index+1}`,at,admin]);
   await owner.query("INSERT INTO vendor_account_capacity(vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by) VALUES($1,$2,5,'2026-01-01',$3,$4)",[account,licenses[index],at,admin]);
   await owner.query("INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,'active','UI oracle',$7,$8)",[requests[index],`REQ-US075-UI-${index}`,person,company,account,licenses[index],at,admin]);
   await owner.query("INSERT INTO license_assignment(id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_request_id,source_kind,created_at,created_by) VALUES($1,$2,$3,$4,$5,'2026-07-28',$6,'request',$7,$8)",[assignments[index],person,company,account,licenses[index],requests[index],at,admin]);
   await owner.query("UPDATE license_request SET license_assignment_id=$1 WHERE id=$2",[assignments[index],requests[index]]);
  }
  const repository=createPeopleRepository(database),authorizationRepository=createAuthorizationRepository(database);
  const action=async(input:unknown)=>{
   const authorization=await authorizationRepository.load({subject:"us075-ui-admin"});
   return (await executeOffboardingIntent(repository,authorization,input,at)).state;
  };
  const user=userEvent.setup();
  render(<NextIntlClientProvider locale="es-EC" messages={esMessages}><PersonOffboarding action={action} labels={labels} personId={person}/></NextIntlClientProvider>);
  await user.click(screen.getByTestId("btn_start_offboarding"));
  await screen.findByRole("option",{name:"UI account · UI seat 2"});
  expect((await owner.query("SELECT count(*)::int AS count FROM provisioning_action WHERE request_id=ANY($1::uuid[])",[requests])).rows).toEqual([{count:0}]);
  await user.selectOptions(screen.getByTestId("offboarding_target"),requests[1]!);
  await user.selectOptions(screen.getByTestId("end_reason"),"inactive");
  await user.type(screen.getByLabelText(labels.offboardingNote),"Remove only UI seat 2");
  await user.click(screen.getByTestId("btn_confirm_offboarding"));
  await screen.findByText(labels.offboardingSuccess);
  expect(screen.getByRole("link",{name:esMessages.people.offboardingViewRequest}).getAttribute("href")).toBe(`/solicitudes/${requests[1]}`);
  await waitFor(()=>expect((screen.getByTestId("modal_offboarding") as HTMLDetailsElement).open).toBe(false));
  const persisted=await owner.query("SELECT request.id::text,request.state,assignment.ended_on,assignment.end_reason,(SELECT count(*)::int FROM provisioning_action WHERE request_id=request.id) AS actions,(SELECT count(*)::int FROM request_transition WHERE request_id=request.id) AS transitions FROM license_request request JOIN license_assignment assignment ON assignment.id=request.license_assignment_id WHERE request.id=ANY($1::uuid[]) ORDER BY request.id",[requests]);
  expect(persisted.rows).toEqual([{id:requests[0],state:"active",ended_on:null,end_reason:null,actions:0,transitions:0},{id:requests[1],state:"offboarding",ended_on:null,end_reason:null,actions:1,transitions:1}]);
  expect((await owner.query("SELECT kind,mode,status,raw_request->'context' AS context FROM provisioning_action WHERE request_id=$1",[requests[1]])).rows).toEqual([{kind:"remove",mode:"orchestration",status:"pending",context:{assignmentIds:[assignments[1]],endReason:"inactive",note:"Remove only UI seat 2",personId:person,requestId:requests[1],vendorAccountId:account}}]);
  expect((await owner.query("SELECT status FROM person WHERE id=$1",[person])).rows).toEqual([{status:"active"}]);
  expect((await owner.query("SELECT purchased_qty FROM vendor_account_capacity WHERE vendor_account_id=$1 ORDER BY license_type_id",[account])).rows).toEqual([{purchased_qty:5},{purchased_qty:5}]);
  expect((await owner.query("SELECT count(*)::int AS count FROM audit_log WHERE entity_id=$1 AND action='person.offboarding_started'",[person])).rows).toEqual([{count:1}]);
 }finally{cleanup();await pool?.end();await owner?.end();await fixture.stop();}
},120_000);
