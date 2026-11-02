import "next/dist/server/node-environment";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire, registerHooks } from "node:module";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import pg from "pg";

const require = createRequire(import.meta.url);
let productionPool: pg.Pool;
let localePool: pg.Pool;
let ReconciliationPage: typeof import("./page").default;
let actions: typeof import("@/modules/close/reconciliation-actions");
let hooks: ReturnType<typeof registerHooks>;
let data: Awaited<ReturnType<typeof createCloseFixture>>;
const saved = vi.hoisted(() => {
  const original = { AUTH_SECRET: process.env.AUTH_SECRET, AUTH_URL: process.env.AUTH_URL, AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST, DATABASE_URL: process.env.DATABASE_URL, DB_DRIVER: process.env.DB_DRIVER, TZ:process.env.TZ };
  process.env.TZ="UTC";
  process.env.AUTH_SECRET = "us034-genuine-signed-session-fixture-secret";
  process.env.AUTH_URL = "http://localhost:3000";
  process.env.AUTH_TRUST_HOST = "true";
  return original;
});
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  data = await createCloseFixture();
  process.env.DATABASE_URL = data.fixture.appUrl;
  process.env.DB_DRIVER = "pg";
  hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "next-intl/server" || (specifier.includes("/next-intl/dist/esm/") && specifier.endsWith("/server.react-client.js"))) return nextResolve(new URL("../../../../node_modules/next-intl/dist/esm/development/server.react-server.js", import.meta.url).href, context);
    if (specifier === "next-intl/config" || (specifier.includes("/next-intl/dist/esm/") && specifier.endsWith("/config.js"))) return nextResolve(new URL("../../../lib/i18n/request.ts", import.meta.url).href, context);
    if (specifier.startsWith("@/")) specifier = new URL("../../../" + specifier.slice(2), import.meta.url).href;
    if (["next/headers", "next/server", "next/navigation"].includes(specifier)) specifier += ".js";
    if ((specifier.startsWith("file:") || specifier.startsWith(".")) && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      if (!existsSync(url)) for (const suffix of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(new URL(url.href + suffix))) return nextResolve(url.href + suffix, context);
      }
    }
    return nextResolve(specifier, context);
  }, load(url, context, nextLoad) {
    if (["/modules/close/", "/app/(authenticated)/conciliacion/"].some(path => decodeURI(url).includes(path))) throw new Error("Scored usage modules must remain Vitest-loaded");
    if (url.startsWith(new URL("../../../../../../", import.meta.url).href) && /\.tsx?$/.test(url)) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    }
    if (url.startsWith(new URL("../../../../messages/", import.meta.url).href) && url.endsWith(".json")) return { format: "module", shortCircuit: true, source: "export default " + readFileSync(new URL(url), "utf8") };
    return nextLoad(url, context);
  } });
  ReconciliationPage = (await import(require.resolve("./page.tsx"))).default;
  actions = await import("@/modules/close/reconciliation-actions");
  productionPool = ((await import(require.resolve("@smp/db"))).db as unknown as { $client: pg.Pool }).$client;
  process.env.AUTH_SECRET = "us034-genuine-signed-session-fixture-secret";
  process.env.AUTH_URL = "http://localhost:3000";
  process.env.AUTH_TRUST_HOST = "true";
});
beforeEach(async()=>{ await data.owner.query("TRUNCATE reconciliation_variance_line,reconciliation,statement_line,statement,close_run,audit_log CASCADE"); });
afterAll(async () => {
  // The unchanged request-config module uses Node's native dependency graph.
  if (hooks) {
    localePool = require("@smp/db").db.$client;
    if (localePool !== productionPool) await localePool.end();
  }
  hooks?.deregister();
  await productionPool?.end();
  await data?.stop();
  vi.useRealTimers();
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
async function withSession<T>(subject: string | null, run: () => Promise<T>) {
  const { encode } = await import(require.resolve("next-auth/jwt"));
  const token = subject ? await encode({ secret: process.env.AUTH_SECRET!, salt: "authjs.session-token", token: { idpSubject: subject, displayName: "Verified usage fixture" } }) : null;
  const { createRequestStoreForAPI } = require("next/dist/server/async-storage/request-store");
  const { createWorkStore } = require("next/dist/server/async-storage/work-store");
  const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");
  const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external");
  const url = new URL("http://localhost:3000/conciliacion");
  const request = new Request(url, { headers: { host: url.host, ...(token ? { cookie: "authjs.session-token=" + token } : {}) } });
  const store = createRequestStoreForAPI(request, url, { tags: [], expirationsByCacheKind: new Map() });
  const { IncrementalCache } = require("next/dist/server/lib/incremental-cache");
  const incrementalCache = new IncrementalCache({ dev: true, requestHeaders: {}, getPrerenderManifest: () => ({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: {} }) });
  const work = createWorkStore({ page: "/conciliacion/page", renderOpts: { supportsDynamicResponse: true, isDraftMode: false, incrementalCache }, isPrefetchRequest: false, buildId: "us034-fixture", previouslyRevalidatedTags: [] });
  const result = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, run));
  return { result, work };
}

async function page(subject: string | null, period: string | undefined = "2026-01") { return (await withSession(subject, () => ReconciliationPage({searchParams:Promise.resolve({period})}))).result; }

async function createCloseFixture() {
  const fixture = await createPostgresFixture(); await fixture.migrate();
  const owner = await fixture.connectAsOwner();
  const id = (n: number) => `34100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await owner.query(`INSERT INTO user_account (id,email,idp_subject,global_role,status,created_at)
    VALUES ($1,'finance@rates.invalid','close-finance','central_finance','active','2026-11-01'),
    ($2,'viewer@rates.invalid','close-viewer',NULL,'active','2026-11-01'),
    ($3,'admin@rates.invalid','close-admin','group_admin','active','2026-11-01')`, [id(1),id(2),id(6)]);
  await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
    VALUES ($1,'Manual','manual','none',false,false,false,false,'email','active','2026-11-01',$2)`, [id(3),id(1)]);
  await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
    VALUES ($1,$2,'Native pilot org','orchestration',0,'active','2026-11-01',$3)`, [id(4),id(3),id(1)]);
  await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
    VALUES ($1,$2,'Native seat','seat','active','2026-11-01',$3)`, [id(5),id(3),id(1)]);
  await owner.query(`INSERT INTO rate_card (vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by)
    VALUES ($1,$2,62,'2026-01-01','2026-11-01',$3)`, [id(4),id(5),id(1)]);
  await owner.query(`INSERT INTO vendor_account_capacity (vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by)
    VALUES ($1,$2,140,'2026-01-01','2026-11-01',$3)`, [id(4),id(5),id(1)]);
  await owner.query(`INSERT INTO company (id,name,code,type,status,created_at,created_by) VALUES ($1,'Pilot A','CLOSE-A','internal','active','2026-01-01',$2)`,[id(7),id(1)]);
  await owner.query(`INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by) VALUES ($1,'person@close.invalid','Pilot Person',$2,'active','2026-01-01',$3)`,[id(8),id(7),id(1)]);
  await owner.query(`INSERT INTO license_assignment (person_id,company_id,vendor_account_id,license_type_id,started_on,source_kind,note,created_at) VALUES ($1,$2,$3,$4,'2026-01-01','manual','Pilot register','2026-01-01')`,[id(8),id(7),id(4),id(5)]);
  return { fixture, owner, stop: async () => { await owner.end(); await fixture.stop(); } };
}

const id=(n:number)=>`34100000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function final() {
 await data.owner.query(`INSERT INTO statement(id,company_id,period,status,opening_seats,total_usd,generated_at,created_at) VALUES($1,$2,'2026-01','draft',0,10051,now(),now())`,[id(100),id(7)]);
 await data.owner.query(`INSERT INTO statement_line(statement_id,kind,vendor_account_id,amount_usd) VALUES($1,'adjustment',$2,10051)`,[id(100),id(4)]);
 await data.owner.query(`UPDATE statement SET status='final' WHERE id=$1`,[id(100)]);
}
function form(values:Record<string,string>={}) { const f=new FormData();for(const [k,v] of Object.entries({period:"2026-01",vendorAccountId:id(4),...values}))f.set(k,v);return f; }
test.each([null,"close-viewer"])("real %s session is rejected by the workbench and all actions",async subject=>{
 await expect(page(subject)).rejects.toMatchObject({digest:expect.stringContaining(";/acceso-denegado;")});
 for(const action of Object.values(actions)) {
  const denied=await withSession(subject,()=>action({status:"idle"},form()));
  expect(denied.result).toEqual({status:"error"});expect(denied.work.pendingRevalidatedTags??[]).toEqual([]);
 }
});
test.each(["close-finance","close-admin"])("real %s session renders finalized cards and empty periods",async subject=>{
 expect(renderToStaticMarkup(await page(subject))).toContain("No complete finalized organizations");
 await final();
 const html=renderToStaticMarkup(await page(subject));
 expect(html).toContain("Native pilot org");expect(html).toContain("$10,051.00");expect(html).toContain('name="invoiceAmountUsd"');
 expect(html).toContain('name="period"');expect(html).toContain('value="2026-01"');
});
test("production actions persist invoices and variance CRUD, refresh the route, and record a noted override",async()=>{
 await final();
 const invoke=async(name:keyof typeof actions,values:Record<string,string>)=>{
  const result=await withSession("close-finance",()=>actions[name]({status:"idle"},form(values)));
  if(result.result.status!=="error")expect(result.work.pendingRevalidatedTags.map((r:{tag:string})=>r.tag)).toEqual(["_N_T_/conciliacion"]);
  return result.result;
 };
 const line={cause:"timing",detail:"Timing evidence",registerAmountUsd:"10.00",invoiceAmountUsd:"11.00",evidenceUrl:"https://example.test/evidence"};
 expect(await invoke("saveVarianceLine",line)).toEqual({status:"saved"});
 const row=(await data.owner.query("SELECT * FROM reconciliation_variance_line")).rows[0];
 expect(row).toMatchObject({cause:"timing",detail:"Timing evidence",register_amount_usd:"10.00",invoice_amount_usd:"11.00",difference_usd:"-1.00",evidence_url:line.evidenceUrl,created_by:id(1)});
 expect(await invoke("saveVarianceLine",{...line,lineId:row.id,detail:"Updated",evidenceUrl:""})).toEqual({status:"saved"});
 expect((await data.owner.query("SELECT detail,evidence_url FROM reconciliation_variance_line")).rows).toEqual([{detail:"Updated",evidence_url:null}]);
 expect(await invoke("deleteVarianceLine",{lineId:row.id})).toEqual({status:"saved"});
 expect((await data.owner.query("SELECT * FROM reconciliation_variance_line")).rows).toEqual([]);
 expect(await invoke("saveInvoiceAmount",{invoiceAmountUsd:"10000.00"})).toEqual({status:"saved"});
 expect(await invoke("overrideReconciliation",{note:""})).toEqual({status:"error"});
 expect(await invoke("overrideReconciliation",{note:"Approved timing"})).toEqual({status:"overridden"});
 expect((await data.owner.query("SELECT status,override_note,overridden_by FROM reconciliation")).rows).toEqual([{status:"overridden",override_note:"Approved timing",overridden_by:id(1)}]);
 const html=renderToStaticMarkup(await page("close-finance"));expect(html).toContain("Approved timing");expect(html).not.toContain('type="submit" disabled');
 for(const [name,values] of [["saveInvoiceAmount",{invoiceAmountUsd:"1.00"}],["saveVarianceLine",line],["deleteVarianceLine",{lineId:row.id}],["overrideReconciliation",{note:"Again"}]] as const) expect(await invoke(name,values)).toEqual({status:"error"});
});
test("invoice action automatically reconciles and rejects malformed inputs without revalidation",async()=>{
 await final();
 for(const invoiceAmountUsd of ["-1.00","1.001","1e3",""]) {
  const result=await withSession("close-finance",()=>actions.saveInvoiceAmount({status:"idle"},form({invoiceAmountUsd})));
  expect(result.result).toEqual({status:"error"});expect(result.work.pendingRevalidatedTags??[]).toEqual([]);
 }
 const result=await withSession("close-admin",()=>actions.saveInvoiceAmount({status:"idle"},form({invoiceAmountUsd:"10051.00"})));
 expect(result.result).toEqual({status:"reconciled"});
 expect((await data.owner.query("SELECT status,variance_usd,rollup_amount_usd FROM reconciliation")).rows).toEqual([{status:"reconciled",variance_usd:"0.00",rollup_amount_usd:"10051.00"}]);
});
test("default/invalid period uses Ecuador month at the UTC boundary; read errors reach the error boundary",async()=>{
 try {
  for(const [instant,expected] of [["2026-11-01T04:59:59.999Z","2026-10"],["2026-11-01T05:00:00.000Z","2026-11"],["2027-01-01T04:59:59.999Z","2026-12"],["2027-01-01T05:00:00.000Z","2027-01"]]) {
   vi.setSystemTime(new Date(instant!));
   expect(renderToStaticMarkup(await page("close-finance","bad"))).toContain('value="'+expected+'"');
  }
 } finally {vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));}
 await data.owner.query("ALTER TABLE statement RENAME TO unavailable_statement");
 try{await expect(page("close-finance")).rejects.toMatchObject({code:"42P01"});}
 finally{await data.owner.query("ALTER TABLE unavailable_statement RENAME TO statement");}
});

test("authorization database failure returns one error state from every signed-session command without writes or revalidation",async()=>{
 await final();
 await data.owner.query("ALTER TABLE user_account RENAME TO unavailable_reconciliation_user_account");
 try {
  for(const action of Object.values(actions)) {
   const result=await withSession("close-finance",()=>action({status:"idle"},form({invoiceAmountUsd:"10000.00",note:"No authorization available",cause:"timing",detail:"Must not persist",registerAmountUsd:"1.00",evidenceUrl:"https://example.test/evidence"})));
   expect(result.result).toEqual({status:"error"});
   expect(result.work.pendingRevalidatedTags??[]).toEqual([]);
  }
 } finally {await data.owner.query("ALTER TABLE unavailable_reconciliation_user_account RENAME TO user_account");}
 for(const table of ["reconciliation","reconciliation_variance_line","audit_log"])expect((await data.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows).toEqual([{n:0}]);
});

test("real repository lookup failure reaches each factory authorization catch without mutations",async()=>{
 const {drizzle}=await import("drizzle-orm/node-postgres");
 const schema=await import("@smp/db/schema");
 const {createAuthorizationRepository}=await import("@/modules/identity-access/authorization");
 const {createReconciliationActions}=await import("@/modules/close/reconciliation-actions-factory");
 const {revalidatePath}=await import("next/cache");
 const database=drizzle(productionPool,{schema});
 const repository=createAuthorizationRepository(database);
 expect(await repository.load({subject:"close-finance"})).toMatchObject({globalRole:"central_finance",companyIds:[id(7)]});
 const factory=createReconciliationActions({database,loadAuthorization:()=>repository.load({subject:"close-finance"}),revalidate:revalidatePath});
 await data.owner.query("ALTER TABLE user_account RENAME TO unavailable_factory_user_account");
 try {
  await expect(repository.load({subject:"close-finance"})).rejects.toMatchObject({code:"42P01"});
  for(const action of Object.values(factory)) {
   const result=await withSession("close-finance",()=>action({status:"idle"},form({invoiceAmountUsd:"10000.00",note:"No authorization",cause:"timing",detail:"Must not persist",registerAmountUsd:"1.00"})));
   expect(result.result).toEqual({status:"error"});
   expect(result.work.pendingRevalidatedTags??[]).toEqual([]);
  }
 } finally {await data.owner.query("ALTER TABLE unavailable_factory_user_account RENAME TO user_account");}
 for(const table of ["reconciliation","reconciliation_variance_line","audit_log"])expect((await data.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows).toEqual([{n:0}]);
});
