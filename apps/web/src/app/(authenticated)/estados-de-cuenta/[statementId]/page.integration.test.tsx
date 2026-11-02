import "next/dist/server/node-environment";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire, registerHooks } from "node:module";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import pg from "pg";
const require = createRequire(import.meta.url);
const id = (n: number) => `36000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
let fixture: PostgresFixture;
let owner: pg.Client;
let productionPool: pg.Pool;
let localePool: pg.Pool;
let Page: typeof import("./page").default;
let ListPage: typeof import("../page").default;
let download: typeof import("@/app/api/v1/statements/[statementId]/export/csv/route").GET;
let exportAction: typeof import("@/modules/statements/server-actions").exportStatementCsv;
let hooks: ReturnType<typeof registerHooks>;
const saved = vi.hoisted(() => {
 const original = { AUTH_SECRET:process.env.AUTH_SECRET,AUTH_URL:process.env.AUTH_URL,AUTH_TRUST_HOST:process.env.AUTH_TRUST_HOST,DATABASE_URL:process.env.DATABASE_URL,DB_DRIVER:process.env.DB_DRIVER };
 process.env.AUTH_SECRET="us036-signed-session-fixture-secret";
 process.env.AUTH_URL="http://localhost:3000";
 process.env.AUTH_TRUST_HOST="true";
 return original;
});
beforeAll(async () => {
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
 fixture=await createPostgresFixture();await fixture.migrate();owner=await fixture.connectAsOwner();
 await owner.query(`INSERT INTO user_account (id,email,idp_subject,global_role,status,created_at) VALUES
  ('${id(1)}','finance@test.invalid','detail-finance',NULL,'active','2026-08-01'),
  ('${id(2)}','viewer@test.invalid','detail-viewer',NULL,'active','2026-08-01'),
  ('${id(3)}','central@test.invalid','detail-central','central_finance','active','2026-08-01'),
  ('${id(4)}','admin@test.invalid','detail-admin','group_admin','active','2026-08-01'), ('${id(20)}','approver@test.invalid','detail-approver',NULL,'active','2026-08-01');
  INSERT INTO company (id,name,code,type,status,created_at,created_by) VALUES
  ('${id(5)}','Alpha detail','ALP','internal','active','2026-08-01','${id(3)}'),('${id(6)}','Foreign detail','BRV','internal','active','2026-08-01','${id(3)}');
  INSERT INTO company_role_assignment (user_account_id,company_id,role,unique_grant,created_at,created_by) VALUES
  ('${id(20)}','${id(5)}','approver','approver-a','2026-08-01','${id(3)}'), ('${id(1)}','${id(5)}','finance','finance-a','2026-08-01','${id(3)}'),('${id(2)}','${id(5)}','viewer','viewer-a','2026-08-01','${id(3)}');
  INSERT INTO statement (id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES
  ('${id(7)}','${id(5)}','2026-07','draft',0,21.29,'2026-08-01','2026-08-01'),
  ('${id(8)}','${id(6)}','2026-07','final',0,0,'2026-08-01','2026-08-01');`);
 await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
 VALUES ('${id(10)}','Manual','manual','none',false,false,false,false,'email','active','2026-08-01','${id(3)}');
 INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
 VALUES ('${id(11)}','${id(10)}','Detail org','orchestration',0,'active','2026-08-01','${id(3)}');
 INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
 VALUES ('${id(12)}','${id(10)}','Detail seat','seat','active','2026-08-01','${id(3)}');
 INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by)
 VALUES ('${id(13)}','person@detail.invalid','Detail Alice','${id(5)}','active','2026-08-01','${id(3)}');
 INSERT INTO license_assignment (id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_kind,note,created_at,created_by)
 VALUES ('${id(14)}','${id(13)}','${id(5)}','${id(11)}','${id(12)}','2026-07-10','manual','Signed evidence','2026-08-01','${id(3)}');
 INSERT INTO statement_line (id,statement_id,kind,person_id,vendor_account_id,license_type_id,assignment_id,license_days,rate_usd,amount_usd,period_from,period_to)
 VALUES ('${id(15)}','${id(7)}','license','${id(13)}','${id(11)}','${id(12)}','${id(14)}',11,60.00,21.29,'2026-07-10','2026-07-20');`);
 process.env.DATABASE_URL=fixture.appUrl;process.env.DB_DRIVER="pg";
 hooks=registerHooks({resolve(specifier,context,nextResolve) {
  if(specifier==="next-intl/server" || (specifier.includes("/next-intl/dist/esm/") && specifier.endsWith("/server.react-client.js"))) return nextResolve(new URL("../../../../../node_modules/next-intl/dist/esm/development/server.react-server.js",import.meta.url).href,context);
  if(specifier==="next-intl/config" || (specifier.includes("/next-intl/dist/esm/") && specifier.endsWith("/config.js"))) return nextResolve(new URL("../../../../lib/i18n/request.ts",import.meta.url).href,context);
  if(specifier.startsWith("@/")) specifier=new URL("../../../../"+specifier.slice(2),import.meta.url).href;
  if(["next/headers","next/server","next/navigation"].includes(specifier)) specifier+=".js";
  if((specifier.startsWith("file:") || specifier.startsWith(".")) && context.parentURL) {
   const url=new URL(specifier,context.parentURL);
   if(!existsSync(url)) for(const suffix of [".ts",".tsx","/index.ts"]) if(existsSync(new URL(url.href+suffix))) return nextResolve(url.href+suffix,context);
  }
  return nextResolve(specifier,context);
 },load(url,context,nextLoad) {
  if(["/modules/statements/","/app/(authenticated)/estados-de-cuenta/"].some(path=>decodeURI(url).includes(path))) throw new Error("Scored statement modules must remain Vitest-loaded");
  if(url.startsWith(new URL("../../../../../../../",import.meta.url).href) && /\.tsx?$/.test(url)) return {format:"module",shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText};
  if(url.startsWith(new URL("../../../../../messages/",import.meta.url).href) && url.endsWith(".json")) return {format:"module",shortCircuit:true,source:"export default "+readFileSync(new URL(url),"utf8")};
  return nextLoad(url,context);
 }});
 Page=(await import(require.resolve("./page.tsx"))).default;
 ListPage=(await import("../page")).default;
 download=(await import("@/app/api/v1/statements/[statementId]/export/csv/route")).GET;
 exportAction=(await import("@/modules/statements/server-actions")).exportStatementCsv;
 productionPool=((await import(require.resolve("@smp/db"))).db as unknown as {$client:pg.Pool}).$client;
});
afterAll(async()=>{if(hooks){localePool=require("@smp/db").db.$client;if(localePool!==productionPool)await localePool.end();}hooks?.deregister();await productionPool?.end();await owner?.end();await fixture?.stop();vi.useRealTimers();for(const [key,value] of Object.entries(saved)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}});
function page(subject:string|null,statementId?:string,uiLanguage?:string,operation?:"page"): Promise<Awaited<ReturnType<typeof Page>>>;
function page(subject:string|null,statementId:string,uiLanguage:string,operation:"csv"): Promise<Response>;
function page(subject:string|null,statementId:string,uiLanguage:string,operation:"action"): Promise<{downloadUrl:string}>;
function page(subject:string|null,statementId:string,uiLanguage:string,operation:"list",listFilters:{period?:string;companyId?:string}): Promise<Awaited<ReturnType<typeof ListPage>>>;
async function page(subject:string|null,statementId=id(7),uiLanguage="en", operation: "page"|"csv"|"action"|"list"="page",listFilters?:{period?:string;companyId?:string}) {
 if(subject) await owner.query("UPDATE user_account SET ui_language=$1 WHERE idp_subject=$2",[uiLanguage,subject]);
 const {encode}=await import(require.resolve("next-auth/jwt"));
 const token=subject?await encode({secret:process.env.AUTH_SECRET!,salt:"authjs.session-token",token:{idpSubject:subject,displayName:"Verified finance",uiLanguage}}):null;
 const {createRequestStoreForAPI}=require("next/dist/server/async-storage/request-store");
 const {createWorkStore}=require("next/dist/server/async-storage/work-store");
 const {workAsyncStorage}=require("next/dist/server/app-render/work-async-storage.external");
 const {workUnitAsyncStorage}=require("next/dist/server/app-render/work-unit-async-storage.external");
 const url=new URL("http://localhost:3000/estados-de-cuenta/"+statementId);
 const request=new Request(url,{headers:{host:url.host,...(token?{cookie:"authjs.session-token="+token}:{})}});
 const store=createRequestStoreForAPI(request,url,{tags:[],expirationsByCacheKind:new Map()});
 const work=createWorkStore({page:"/estados-de-cuenta/[statementId]/page",renderOpts:{supportsDynamicResponse:true,isDraftMode:false},isPrefetchRequest:false,buildId:"us036",previouslyRevalidatedTags:[]});
 return workAsyncStorage.run(work,()=>workUnitAsyncStorage.run(store,()=>operation === "list" ? ListPage({searchParams:Promise.resolve(listFilters!)}) : operation === "csv" ? download(request,{params:Promise.resolve({statementId})}) : operation === "action" ? exportAction(statementId) : Page({params:Promise.resolve({statementId})})));
}
test.each([null])("signed %s cannot open statement detail",async subject=>{await expect(page(subject)).rejects.toMatchObject({digest:expect.stringContaining(";/acceso-denegado;")});});
test.each(["detail-finance","detail-approver","detail-viewer"])("signed %s reads only own evidence and denies foreign/missing IDs",async subject=>{
 const html=renderToStaticMarkup(await page(subject));expect(html).toContain("Statement · Alpha detail");expect(html).toContain("$21.29");expect(html).toContain("Signed evidence");expect(html).not.toContain('data-testid="btn_view_register"');expect(html).not.toContain("Foreign detail");
 for(const statementId of [id(8),id(999),"bad-id"]) await expect(page(subject,statementId)).rejects.toMatchObject({digest:expect.stringContaining(";/acceso-denegado;")});
});
test.each(["detail-central","detail-admin"])("signed %s sees other-company detail",async subject=>{
 expect(renderToStaticMarkup(await page(subject,id(8)))).toContain("Foreign detail");
 expect(renderToStaticMarkup(await page(subject))).toContain('data-testid="btn_view_register"');
});
test("signed locale controls the detail copy and DB failures propagate to recovery boundary",async()=>{
 const spanish=renderToStaticMarkup(await page("detail-finance",id(7),"es"));expect(spanish).toContain("Estado de cuenta");expect(spanish).toContain("USD 21,29");
 await owner.query("ALTER TABLE statement RENAME TO unavailable_statement");
 try {await expect(page("detail-finance")).rejects.toMatchObject({code:"42P01"});} finally {await owner.query("ALTER TABLE unavailable_statement RENAME TO statement");}
});

test.each(["detail-finance","detail-approver","detail-viewer"])("US-041 signed %s lists only own company without administration",async subject=>{
 const html=renderToStaticMarkup(await page(subject,id(7),"en","list",{period:"2026-07"}));
 expect(html).toContain("Alpha detail");expect(html).not.toContain("Foreign detail");
 expect(html).not.toContain('data-testid="filter_company"');
 expect(html).toContain('method="get"');expect(html).not.toContain('method="post"');expect(html).not.toContain('/cierre');
 await expect(page(subject,id(7),"en","list",{period:"2026-07",companyId:id(6)})).rejects.toMatchObject({digest:expect.stringContaining(";/acceso-denegado;")});
});

// Real signed-session seam: adapter auth, fresh DB grants, URL action and actual download.
test("CSV download and action independently resolve signed finance grants, language and audit", async () => {
 for (const [subject,statementId,status] of [[null,id(7),401],["detail-finance",id(8),404],["detail-finance","bad-id",400]] as const) {
   const response=await page(subject,statementId,"en","csv");
   expect(response.status).toBe(status);
 }
 for(const subject of ["detail-finance","detail-approver","detail-viewer","detail-central","detail-admin"]) {
   expect(await page(subject,id(7),"en","action")).toEqual({downloadUrl:`/api/v1/statements/${id(7)}/export/csv`});
   const response=await page(subject,id(7),"en","csv");
   expect(response.status).toBe(200);
   expect(response.headers.get("cache-control")).toBe("private, no-store");
   const csv=await response.text();
   expect(csv).toContain("Compañía,Período,Estado");
   expect(csv).toContain("Detail Alice");expect(csv).not.toContain("Foreign detail");
 }
 for(const subject of ["detail-finance","detail-approver","detail-viewer"]) expect((await page(subject,id(8),"en","csv")).status).toBe(404);
 await expect(page(null,id(7),"en","action")).rejects.toThrow("UNAUTHORIZED");
 const audits=await owner.query("SELECT entity_id,company_id,actor_user_id FROM audit_log WHERE action='statement.export_csv' ORDER BY actor_user_id");
 expect(audits.rows).toEqual([1,2,3,4,20].map(n=>({entity_id:id(7),company_id:id(5),actor_user_id:id(n)})));
 // Revoke after issuing a URL: every scoped role must be reauthorized on download.
 for(const [n,subject,role,key] of [[1,"detail-finance","finance","finance-a"],[2,"detail-viewer","viewer","viewer-a"],[20,"detail-approver","approver","approver-a"]] as const) {
  await owner.query("DELETE FROM company_role_assignment WHERE user_account_id=$1",[id(n)]);
  try {expect((await page(subject,id(7),"en","csv")).status).toBe(403);}
  finally {await owner.query("INSERT INTO company_role_assignment (user_account_id,company_id,role,unique_grant,created_at,created_by) VALUES ($1,$2,$3,$4,'2026-08-01',$5)",[id(n),id(5),role,key,id(3)]);}
 }
});
