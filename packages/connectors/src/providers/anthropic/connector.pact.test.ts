import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PactV3 } from "@pact-foundation/pact";
import { expect, test } from "vitest";
import { createConnectorCallObservationSession, type ConnectorCallObservationAppendInput } from "../../connector-call-observation";
import { createAnthropicConnector } from "./connector";
import { createAnthropicRateLimiter } from "./rate-limiter";

const account = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const pinned = "invite-pinned";
const at = new Date("2026-10-02T15:00:00Z");
const invite = (id: string, status = "pending") => ({ id, type: "invite", email: "selected@example.test", status });
const page = (data: unknown[], more = false) => ({ data, has_more: more, first_id: data.length ? "first" : null, last_id: data.length ? "last" : null });
const failure = { ok: false, code: "provider_error", retryable: false, raw: null };

test.each([
  { name: "confirmed pinned deletion beyond first page", pages: [page([invite("other")], true), page([invite(pinned)])], body: { id: pinned, type: "invite_deleted" }, status: 200, success: true },
  { name: "non200 201 matching receipt refusal", pages: [page([invite(pinned)])], body: { id: pinned, type: "invite_deleted" }, status: 201 },
  { name: "non200 202 matching receipt refusal", pages: [page([invite(pinned)])], body: { id: pinned, type: "invite_deleted" }, status: 202 },
  { name: "non200 206 matching receipt refusal", pages: [page([invite(pinned)])], body: { id: pinned, type: "invite_deleted" }, status: 206 },
  { name: "accepted refusal", pages: [page([invite(pinned,"accepted")])], noDelete: true },
  { name: "expired refusal", pages: [page([invite(pinned,"expired")])], noDelete: true },
  { name: "missing pinned invitation", pages: [page([invite("other")])], noDelete: true },
  { name: "duplicate pinned identity", pages: [page([invite(pinned),invite(pinned)])], noDelete: true },
  { name: "duplicate nonpinned identity across pages", pages: [page([invite("other")],true),page([invite("other"),invite(pinned)])], noDelete: true },
  { name: "malformed page", pages: [page([{ id: pinned }])], noDelete: true },
  { name: "acceptance race returns 400", pages: [page([invite(pinned)])], body: { error: { type: "invalid_request_error", message: "Invite accepted" } }, status: 400 },
  { name: "expired race returns 400", pages: [page([invite(pinned)])], body: { error: { type: "invalid_request_error", message: "Invite expired" } }, status: 400 },
  { name: "uncertain 500 cannot repeat delete", pages: [page([invite(pinned)])], body: { error: "uncertain" }, status: 500 },
  { name: "429 cannot repeat delete", pages: [page([invite(pinned)])], body: { error: "limit" }, status: 429 },
  { name: "mismatched receipt", pages: [page([invite(pinned)])], body: { id: "other", type: "invite_deleted" }, status: 200 },
  { name: "wrong receipt type", pages: [page([invite(pinned)])], body: { id: pinned, type: "user_deleted" }, status: 200 },
  { name: "missing receipt", pages: [page([invite(pinned)])], body: {}, status: 200 },
])("withdrawal contract: $name", async (scenario) => {
  // Kills email targeting, first-page-only selection, permissive status/receipt and member-deletion mutants.
  const dir = mkdtempSync(join(tmpdir(),"us068-pact-"));
  const pact = new PactV3({ consumer: "ledger-invitation-withdrawal", provider: "anthropic-enterprise-api", dir, logLevel: "error" });
  scenario.pages.forEach((body,index) => pact.addInteraction({ uponReceiving: `${scenario.name} page ${index}`, withRequest: {
    method: "GET", path: "/v1/organizations/invites", query: index ? { limit: "1000", after_id: "last" } : { limit: "1000" },
  }, willRespondWith: { status: 200, headers: { "Content-Type": "application/json" }, body } }));
  if (!scenario.noDelete) pact.addInteraction({ uponReceiving: `${scenario.name} pinned delete`, withRequest: { method: "DELETE", path: `/v1/organizations/invites/${pinned}` }, willRespondWith: { status: scenario.status!, headers: { "Content-Type": "application/json" }, body: scenario.body } });
  try {
    await pact.executeTest(async (server) => {
      const calls: { method: string; path: string }[] = [];
      const observations:ConnectorCallObservationAppendInput[]=[];
      const clock = { now: () => at.getTime() }, sleep = async () => undefined;
      const connector = createAnthropicConnector({ credentialsFor: async () => [
        { vendorAccountId: account, kind: "admin_scoped", secret: "contract-admin", status: "active", health: "ok" },
        { vendorAccountId: account, kind: "analytics", secret: "contract-analytics", status: "active", health: "ok" },
      ], observationSessionFor: async (input) => createConnectorCallObservationSession({ vendorAccountId: account, provisioningActionId: null, operation: input.operation, clock: () => at, randomId: () => requestId, append: async (event) => {observations.push(event);} }),
      requestDependencies: { clock, sleep, limiter: createAnthropicRateLimiter({ clock, sleep }), transport: async (input) => {
        const url = new URL(input.url); calls.push({ method: input.method, path: url.pathname });
        const response = await fetch(new Request(new URL(url.pathname + url.search, server.url),input));
        return response;
      } } });
      expect(typeof connector.withdrawInvitation).toBe("function");
      const result = await connector.withdrawInvitation!({ requestId, vendorAccountId: account, vendorRef: pinned });
      expect(result).toEqual(scenario.success ? { ok: true, vendorRef: pinned, receipt: { id: pinned, type: "invite_deleted" } } : failure);
      expect(calls.filter(call => call.method === "DELETE").map(call => call.path)).toEqual(scenario.noDelete ? [] : [`/v1/organizations/invites/${pinned}`]);
      expect(calls.some(call => call.path.includes("/users"))).toBe(false);
      if(scenario.status === 429 || scenario.status === 500){
        const classification=scenario.status === 429?"rate_limited":"provider_error";
        expect(observations.filter(event=>event.summary.method === "DELETE").map(({phase,classification,summary})=>({phase,classification,summary}))).toEqual([
          {phase:"requested",classification:null,summary:{endpoint_class:"invitations",method:"DELETE"}},
          {phase:"failed",classification,summary:{endpoint_class:"invitations",method:"DELETE",http_status:scenario.status,status_class:classification}},
          {phase:"requested",classification:null,summary:{endpoint_class:"invitations",method:"DELETE"}},
        ]);
      }
    });
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("missing reference and transport ambiguity fail closed", async () => {
  let calls = 0;const observations:ConnectorCallObservationAppendInput[]=[];
  const clock = { now: () => at.getTime() }, sleep = async () => undefined;
  const connector = createAnthropicConnector({ credentialsFor: async () => [
    {vendorAccountId:account,kind:"admin_scoped",secret:"admin",status:"active",health:"ok"},
    {vendorAccountId:account,kind:"analytics",secret:"analytics",status:"active",health:"ok"},
  ], observationSessionFor: async (input) => createConnectorCallObservationSession({ vendorAccountId: account, provisioningActionId:null,operation:input.operation,clock:()=>at,randomId:()=>requestId,append:async(event)=>{observations.push(event);} }),
    requestDependencies:{clock,sleep,limiter:createAnthropicRateLimiter({clock,sleep}),transport:async()=>{ calls++; throw new Error("network uncertain"); }} });
  expect(typeof connector.withdrawInvitation).toBe("function");
  expect(await connector.withdrawInvitation!({requestId,vendorAccountId:account,vendorRef:""})).toEqual(failure);
  expect(calls).toBe(0);expect(observations).toEqual([]);
  const result = await connector.withdrawInvitation!({requestId,vendorAccountId:account,vendorRef:pinned});
  expect(result.ok).toBe(false);expect(observations.map(({phase,classification,summary})=>({phase,classification,summary}))).toEqual([{phase:"requested",classification:null,summary:{endpoint_class:"invitations",method:"GET"}}]);
});


test("invitation withdrawal single-DELETE gate preserves legacy deprovision retry policy",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"us068-legacy-pact-"));const pact=new PactV3({consumer:"ledger-legacy-deprovision",provider:"anthropic-enterprise-api",dir,logLevel:"error"});
 pact.addInteraction({uponReceiving:"legacy members lookup",withRequest:{method:"GET",path:"/v1/organizations/users",query:{limit:"1000"}},willRespondWith:{status:200,headers:{"Content-Type":"application/json"},body:page([])}});
 pact.addInteraction({uponReceiving:"legacy invitation lookup",withRequest:{method:"GET",path:"/v1/organizations/invites",query:{limit:"1000"}},willRespondWith:{status:200,headers:{"Content-Type":"application/json"},body:page([invite(pinned)])}});
 pact.addInteraction({uponReceiving:"legacy invitation removal temporarily unavailable",withRequest:{method:"DELETE",path:"/v1/organizations/invites/"+pinned},willRespondWith:{status:500,headers:{"Content-Type":"application/json"},body:{error:"unavailable"}}});
 try{await pact.executeTest(async(server)=>{
  const observations:ConnectorCallObservationAppendInput[]=[];const calls:{method:string;path:string}[]=[],clock={now:()=>at.getTime()},sleep=async()=>undefined;
  const connector=createAnthropicConnector({credentialsFor:async()=>[{vendorAccountId:account,kind:"admin_scoped",secret:"contract-admin",status:"active",health:"ok"},{vendorAccountId:account,kind:"analytics",secret:"contract-analytics",status:"active",health:"ok"}],observationSessionFor:async(input)=>createConnectorCallObservationSession({vendorAccountId:account,provisioningActionId:null,operation:input.operation,clock:()=>at,randomId:()=>requestId,append:async(event)=>{observations.push(event);}}),requestDependencies:{clock,sleep,limiter:createAnthropicRateLimiter({clock,sleep}),transport:async(input)=>{
   const url=new URL(input.url);calls.push({method:input.method,path:url.pathname});return fetch(new Request(new URL(url.pathname+url.search,server.url),input));
  }}});
  expect(await connector.deprovision({requestId,vendorAccountId:account,personEmail:"selected@example.test",licenseTypeName:"Claude"})).toEqual({...failure,retryable:true});
  expect(calls.filter(call=>call.method === "DELETE")).toEqual(Array.from({length:3},()=>({method:"DELETE",path:"/v1/organizations/invites/"+pinned})));
  expect(observations.filter(event=>event.summary.method === "DELETE").map(({phase,classification,summary})=>({phase,classification,summary}))).toEqual(Array.from({length:3},()=>[{phase:"requested",classification:null,summary:{endpoint_class:"invitations",method:"DELETE"}},{phase:"failed",classification:"provider_error",summary:{endpoint_class:"invitations",method:"DELETE",http_status:500,status_class:"provider_error"}}]).flat());
 });}finally{rmSync(dir,{recursive:true,force:true});}
});


test("documented per-person activity uses analytics credentials and opaque pages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "us070-activity-pact-"));
  const pact = new PactV3({consumer:"ledger-person-activity",provider:"anthropic-enterprise-api",dir,logLevel:"error"});
  const day = "2026-10-03";
  const bodies = [
    {data:[{user:{type:"user",id:"u-a",email_address:"ALICE@example.test"},chat_metrics:{message_count:2,thinking_message_count:null},unrelated:{authorization:"must-not-persist"}}],has_more:true,next_page:"opaque /+="},
    {data:[{user:{type:"user",id:"u-b",email_address:"bob@example.test"},chat_metrics:{message_count:7}},{user:null,chat_metrics:{message_count:3}}],has_more:false,next_page:null},
  ];
  bodies.forEach((body,index)=>pact.addInteraction({uponReceiving:`person activity page ${index}`,withRequest:{method:"GET",path:"/v1/organizations/analytics/users",query:index ? {date:day,page:"opaque /+="}:{date:day},headers:{"X-Api-Key":"contract-analytics","anthropic-version":"2023-06-01"}},willRespondWith:{status:200,headers:{"Content-Type":"application/json"},body}}));
  try { await pact.executeTest(async server => {
    const calls:string[] = [], observations:ConnectorCallObservationAppendInput[]=[];
    const clock={now:()=>at.getTime()},sleep=async()=>undefined;
    const connector=createAnthropicConnector({credentialsFor:async()=>[
      {vendorAccountId:account,kind:"admin_scoped",secret:"contract-admin",status:"active",health:"ok"},
      {vendorAccountId:account,kind:"analytics",secret:"contract-analytics",status:"active",health:"ok"},
    ],observationSessionFor:async input=>createConnectorCallObservationSession({vendorAccountId:account,provisioningActionId:null,operation:input.operation,clock:()=>at,randomId:()=>requestId,append:async event=>{observations.push(event);}}),requestDependencies:{clock,sleep,limiter:createAnthropicRateLimiter({clock,sleep}),transport:async input=>{
      const url=new URL(input.url);calls.push(url.pathname);
      return fetch(new Request(new URL(url.pathname+url.search,server.url),input));
    }}});
    const result=await connector.syncActivity({vendorAccountId:account,observedAt:new Date(day+"T00:00:00Z")});
    expect(result.ok).toBe(true);if(!result.ok) throw new Error("expected activity");
    expect(result.raw).toBeNull();
    expect(result.value.records).toEqual([
      {email:"alice@example.test",providerUserId:"u-a",activityDate:day,counters:{chat_metrics:{message_count:2,thinking_message_count:null}}},
      {email:"bob@example.test",providerUserId:"u-b",activityDate:day,counters:{chat_metrics:{message_count:7}}},
      {email:null,providerUserId:null,activityDate:day,counters:{chat_metrics:{message_count:3}}},
    ]);
    expect(calls).toEqual(Array(2).fill("/v1/organizations/analytics/users"));
    expect(JSON.stringify([result,observations])).not.toMatch(/must-not-persist|contract-admin|contract-analytics|authorization/);
  }); } finally {rmSync(dir,{recursive:true,force:true});}
});

// Provider schema: https://platform.claude.com/docs/en/api/http/beta/organization/analytics/user_cost_report/list
// Amount is fractional cents; actor.email_address is nullable; pages retain identical date bounds.
test("documented per-user cost uses one day, exact fractional cents and nullable actors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "us071-cost-pact-"));
  const pact = new PactV3({consumer:"ledger-person-cost",provider:"anthropic-enterprise-api",dir,logLevel:"error"});
  const row = (id:string,email:string|null,amount:string) => ({
    actor:{type:"user_actor",deleted:email===null,email,email_address:email,name:email===null?"Deleted User":"Member",user_id:id},
    amount,list_amount:amount,currency:"USD",starting_at:"2026-10-01T00:00:00Z",ending_at:"2026-10-02T00:00:00Z",
    model:null,product:null,requests:1,cost_type:null,context_window:null,inference_geo:null,
    rbac_group_id:null,slack_channel_id:null,speed:null,token_type:null,claude_tag_category:null,claude_tag_user_id:null,
  });
  const bodies = [
    {data:[{...row("u-a","ALICE@example.test","123.450000"),unknown:{authorization:"must-not-persist"}}],has_more:true,next_page:"opaque /+=",organization_id:"org-contract",data_refreshed_at:"2026-10-02T15:00:00Z"},
    {data:[row("u-deleted",null,"-123.45"),{...row("unused",null,"0.000000"),actor:null}],has_more:false,next_page:null,organization_id:"org-contract",data_refreshed_at:"2026-10-02T15:00:00Z"},
  ];
  bodies.forEach((body,index)=>pact.addInteraction({uponReceiving:`person cost page ${index}`,withRequest:{method:"GET",path:"/v1/organizations/analytics/user_cost_report",query:{starting_at:"2026-10-01T00:00:00Z",ending_at:"2026-10-02T00:00:00Z",bucket_width:"1d",limit:"1",...(index?{page:"opaque /+="}:{})},headers:{"X-Api-Key":"contract-analytics","anthropic-version":"2023-06-01"}},willRespondWith:{status:200,headers:{"Content-Type":"application/json"},body}}));
  try { await pact.executeTest(async server => {
    const calls:string[] = [], observations:ConnectorCallObservationAppendInput[]=[];
    const clock={now:()=>at.getTime()},sleep=async()=>undefined;
    const connector=createAnthropicConnector({credentialsFor:async()=>[
      {vendorAccountId:account,kind:"admin_scoped",secret:"contract-admin",status:"active",health:"ok"},
      {vendorAccountId:account,kind:"analytics",secret:"contract-analytics",status:"active",health:"ok"},
    ],observationSessionFor:async input=>createConnectorCallObservationSession({vendorAccountId:account,provisioningActionId:null,operation:input.operation,clock:()=>at,randomId:()=>requestId,append:async event=>{observations.push(event);}}),requestDependencies:{clock,sleep,limiter:createAnthropicRateLimiter({clock,sleep}),transport:async input=>{
      const url=new URL(input.url);calls.push(url.pathname);
      return fetch(new Request(new URL(url.pathname+url.search,server.url),input));
    }}});
    const result=await connector.syncCost({vendorAccountId:account,observedAt:new Date("2026-10-01T17:45:00Z")});
    expect(result).toEqual({ok:true,value:{records:[
      {email:"alice@example.test",providerUserId:"u-a",costDate:"2026-10-01",amountUsd:"1.2345",amountCents:"123.450000"},
      {email:null,providerUserId:"u-deleted",costDate:"2026-10-01",amountUsd:"-1.2345",amountCents:"-123.45"},
      {email:null,providerUserId:null,costDate:"2026-10-01",amountUsd:"0",amountCents:"0.000000"},
    ]},raw:{version:1,records:[
      {identity:{email:"alice@example.test",providerUserId:"u-a"},costDate:"2026-10-01",amountUsd:"1.2345",amountCents:"123.450000"},
      {identity:{email:null,providerUserId:"u-deleted"},costDate:"2026-10-01",amountUsd:"-1.2345",amountCents:"-123.45"},
      {identity:{email:null,providerUserId:null},costDate:"2026-10-01",amountUsd:"0",amountCents:"0.000000"},
    ]}});
    expect(JSON.stringify(result)).not.toMatch(/unknown|organization_id|data_refreshed_at|starting_at|ending_at|currency|list_amount|headers|vendorAccountId|source/);
    expect(calls).toEqual(Array(2).fill("/v1/organizations/analytics/user_cost_report"));
    expect(JSON.stringify([result,observations])).not.toMatch(/must-not-persist|contract-admin|contract-analytics|authorization/);
  }); } finally {rmSync(dir,{recursive:true,force:true});}
});


test("US-083 lossless member contract preserves identity, role and both complete streams", async () => {
  const dir=mkdtempSync(join(tmpdir(),"us083-members-pact-"));
  const pact=new PactV3({consumer:"ledger-authoritative-members",provider:"anthropic-enterprise-api",dir,logLevel:"error"});
  const records=[{type:"user",id:"u-null",name:null,email:null,role:"admin"},{type:"user",id:"u-member",name:"Member",email:"MEMBER@example.test",role:"user"}];
  const bodies=[{data:[records[0]],has_more:true,first_id:"u-null",last_id:"u-null"},{data:[records[1]],has_more:false,first_id:"u-member",last_id:"u-member"},{data:[invite("i-one"),{...invite("i-two"),email:null}],has_more:false,first_id:"i-one",last_id:"i-two"}];
  bodies.forEach((body,index)=>pact.addInteraction({uponReceiving:`complete member evidence page ${index}`,withRequest:{method:"GET",path:index<2?"/v1/organizations/users":"/v1/organizations/invites",query:index===1?{limit:"1000",after_id:"u-null"}:{limit:"1000"}},willRespondWith:{status:200,headers:{"Content-Type":"application/json"},body}}));
  try{await pact.executeTest(async server=>{
    const journal:ConnectorCallObservationAppendInput[]=[];
    const clock={now:()=>at.getTime()},sleep=async()=>undefined;
    const connector=createAnthropicConnector({credentialsFor:async()=>[{vendorAccountId:account,kind:"admin_scoped",secret:"contract-admin",status:"active",health:"ok"},{vendorAccountId:account,kind:"analytics",secret:"contract-analytics",status:"active",health:"ok"}],observationSessionFor:async input=>createConnectorCallObservationSession({vendorAccountId:account,provisioningActionId:null,operation:input.operation,clock:()=>at,randomId:()=>requestId,append:async event=>{journal.push(event);}}),requestDependencies:{clock,sleep,limiter:createAnthropicRateLimiter({clock,sleep}),transport:async request=>{const url=new URL(request.url);return fetch(new Request(new URL(url.pathname+url.search,server.url),request));}}});
    const result=await connector.syncMembers({vendorAccountId:account,observedAt:at});
    expect(result.ok).toBe(true);if(!result.ok)throw Error("expected complete evidence");
    const value=result.value as unknown as {records:Record<string,unknown>[];evidence:unknown;members:unknown};
    expect(value.records.map(r=>[r.provider_member_ref,r.email,r.reported_role,r.membership_status,r.seat_evidence])).toEqual([["u-null",null,"admin","member","licensed"],["u-member","member@example.test","user","member","licensed"],["i-one","selected@example.test",null,"invited","unlicensed"],["i-two",null,null,"invited","unlicensed"]]);
    expect(value.evidence).toEqual({member_seat_evidence:"all_members_licensed",member_license_identity:"none"});
    expect(value.members).toEqual([{email:"member@example.test",active:true},{email:"selected@example.test",active:false}]);
    expect(journal.filter(event=>event.phase==="succeeded").map(event=>event.summary.endpoint_class)).toEqual(["members","members","invitations"]);
    expect(JSON.stringify(journal)).not.toMatch(/u-null|MEMBER@example|selected@example|contract-admin/);
  });}finally{rmSync(dir,{recursive:true,force:true});}
});
