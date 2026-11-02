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
let ClosePage: typeof import("./page").default;
let StatementsPage: typeof import("../estados-de-cuenta/page").default;
let runClose: typeof import("@/modules/close/server-actions").runClose;
let finalizeStatement: typeof import("@/modules/close/server-actions").finalizeStatement;
let finalizeStatements: typeof import("@/modules/close/server-actions").finalizeStatements;
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
    if (["/modules/close/", "/modules/statements/", "/app/(authenticated)/cierre/", "/app/(authenticated)/estados-de-cuenta/"].some(path => decodeURI(url).includes(path))) throw new Error("Scored usage modules must remain Vitest-loaded");
    if (url.startsWith(new URL("../../../../../../", import.meta.url).href) && /\.tsx?$/.test(url)) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    }
    if (url.startsWith(new URL("../../../../messages/", import.meta.url).href) && url.endsWith(".json")) return { format: "module", shortCircuit: true, source: "export default " + readFileSync(new URL(url), "utf8") };
    return nextLoad(url, context);
  } });
  ClosePage = (await import(require.resolve("./page.tsx"))).default;
  StatementsPage = (await import("../estados-de-cuenta/page")).default;
  const actions = await import("@/modules/close/server-actions");
  runClose = actions.runClose;
  finalizeStatement = actions.finalizeStatement;
  finalizeStatements = actions.finalizeStatements;
  productionPool = ((await import(require.resolve("@smp/db"))).db as unknown as { $client: pg.Pool }).$client;
  process.env.AUTH_SECRET = "us034-genuine-signed-session-fixture-secret";
  process.env.AUTH_URL = "http://localhost:3000";
  process.env.AUTH_TRUST_HOST = "true";
});
beforeEach(async()=>{ await data.owner.query("TRUNCATE statement_line,statement,close_run,audit_log CASCADE"); });
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
  const url = new URL("http://localhost:3000/cierre");
  const request = new Request(url, { headers: { host: url.host, ...(token ? { cookie: "authjs.session-token=" + token } : {}) } });
  const store = createRequestStoreForAPI(request, url, { tags: [], expirationsByCacheKind: new Map() });
  const { IncrementalCache } = require("next/dist/server/lib/incremental-cache");
  const incrementalCache = new IncrementalCache({ dev: true, requestHeaders: {}, getPrerenderManifest: () => ({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: {} }) });
  const work = createWorkStore({ page: "/cierre/page", renderOpts: { supportsDynamicResponse: true, isDraftMode: false, incrementalCache }, isPrefetchRequest: false, buildId: "us034-fixture", previouslyRevalidatedTags: [] });
  const result = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, run));
  return { result, work };
}

async function page(subject: string | null) { return (await withSession(subject, () => ClosePage({searchParams:Promise.resolve({period:"2026-01"})}))).result; }

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

test.each([null, "close-viewer"])("actual %s session cannot read close runs", async subject => {
  await expect(page(subject)).rejects.toMatchObject({ digest: expect.stringContaining(";/acceso-denegado;") });
});
test.each(["close-finance", "close-admin"])("signed %s session renders the manual license close", async subject => {
  const html=renderToStaticMarkup(await page(subject));
  expect(html).toContain('data-testid="btn_confirm_run_close"');expect(html).toContain("License charges only");expect(html).toContain("2026-01");expect(html).toContain("No close run for this period");
});
test("production runClose verifies signed identity, revalidates and renders the persisted run", async()=>{
  const form=new FormData();form.set("period","2026-01");form.set("note","Production seam");
  for(const subject of [null,"close-viewer"]) {
    const response=await withSession(subject,()=>runClose({status:"idle"},form));
    expect(response.result).toEqual({status:"error"});expect(response.work.pendingRevalidatedTags??[]).toEqual([]);
  }
  const response=await withSession("close-finance",()=>runClose({status:"idle"},form));
  expect(response.result).toMatchObject({status:"succeeded",durationMs:0});
  expect(response.work.pendingRevalidatedTags).toEqual([{tag:"_N_T_/cierre",profile:undefined},{tag:"_N_T_/estados-de-cuenta",profile:undefined}]);
  const html=renderToStaticMarkup(await page("close-finance"));
  expect(html).toContain("Close succeeded");expect(html).toContain("Production seam");expect(html).toContain("Duration");
  expect((await data.owner.query("SELECT total_usd,close_run_id FROM statement")).rows).toEqual([{total_usd:"62.00",close_run_id:"runId" in response.result?response.result.runId:"missing"}]);
});
test("invalid period defaults to the previous completed month and read failures reach the route boundary",async()=>{
  const response=await withSession("close-finance",()=>ClosePage({searchParams:Promise.resolve({period:"bad"})}));
  expect(renderToStaticMarkup(response.result)).toContain("2026-09");
  await data.owner.query("ALTER TABLE close_run RENAME TO unavailable_close_run");
  try { await expect(page("close-finance")).rejects.toMatchObject({code:"42P01"}); }
  finally { await data.owner.query("ALTER TABLE unavailable_close_run RENAME TO close_run"); }
});

test("default period follows Ecuador's completed month at UTC month boundaries",async()=>{
  try {
    for(const [instant,expected] of [["2026-11-01T02:00:00Z","2026-09"],["2027-01-01T06:00:00Z","2026-12"]]) {
      vi.setSystemTime(new Date(instant!));
      const response=await withSession("close-finance",()=>ClosePage({searchParams:Promise.resolve({})}));
      expect(renderToStaticMarkup(response.result)).toContain(expected);
      const list=await withSession("close-finance",()=>StatementsPage({searchParams:Promise.resolve({})}));
      expect(renderToStaticMarkup(list.result)).toContain(expected);
    }
  } finally {vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));}
});

// Missing summary wiring or bypassing the signed-session boundary must fail here.
test("US-096 production pages share stamped totals and enforce finance-grant reads",async()=>{
  const form=new FormData();form.set("period","2026-01");
  await withSession("close-finance",()=>runClose({status:"idle"},form));
  const closeHtml=renderToStaticMarkup(await page("close-finance"));
  expect(closeHtml).toContain('data-testid="tile_group_total"');expect(closeHtml).toContain("62.00");
  const statements=async(subject:string|null,params:{period?:string;companyId?:string;status?:string}={period:"2026-01"})=>(await withSession(subject,()=>StatementsPage({searchParams:Promise.resolve(params)}))).result;
  for(const subject of [null,"close-viewer"])await expect(statements(subject)).rejects.toMatchObject({digest:expect.stringContaining(";/acceso-denegado;")});
  await data.owner.query(`INSERT INTO company_role_assignment(user_account_id,company_id,role,unique_grant,created_at,created_by) VALUES($1,$2,'finance','us096-finance-grant','2026-01-01',$1)`,["34100000-0000-4000-8000-000000000002","34100000-0000-4000-8000-000000000007"]);
  for(const subject of ["close-finance","close-admin","close-viewer"]){
    const html=renderToStaticMarkup(await statements(subject));expect(html).toContain("CLOSE-A");expect(html).toContain("62.00");
    expect(html).toContain("/export/csv");expect(html.includes('data-testid="filter_company"')).toBe(subject!=="close-viewer");
  }
  for(const params of [{period:"bad"},{period:"2026-01",status:"bad"},{period:"2026-01",companyId:"34100000-0000-4000-8000-000000000099"}])await expect(statements("close-viewer",params)).rejects.toMatchObject({digest:expect.stringContaining(";/acceso-denegado;")});
  expect(renderToStaticMarkup(await statements("close-viewer",{}))).toContain("2026-09");
  await data.owner.query(`DELETE FROM company_role_assignment WHERE user_account_id=$1`,["34100000-0000-4000-8000-000000000002"]);
});

test("US-096 localized loading boundary resolves within the real request",async()=>{
 const Loading=(await import("../estados-de-cuenta/loading")).default;
 const result=await withSession("close-finance",()=>Loading());
 expect(renderToStaticMarkup(result.result)).toContain('role="status"');
 expect(renderToStaticMarkup(result.result)).toContain("Cargando estados de cuenta");
});

test("signed finalization actions enforce identity/confirmation and refresh immutable status and rate consumers",async()=>{
  const form=new FormData();form.set("period","2026-01");
  await withSession("close-finance",()=>runClose({status:"idle"},form));
  const row=(await data.owner.query("SELECT id FROM statement")).rows[0];
  form.set("statementId",row.id);
  const draft=renderToStaticMarkup(await page("close-finance"));
  expect(draft).toContain('value="'+row.id+'"');expect(draft).toContain("Finalize period drafts");
  for(const subject of [null,"close-viewer","close-finance"]) {
    const response=await withSession(subject,()=>finalizeStatement({status:"idle"},form));
    expect(response.result).toEqual({status:"error"});expect(response.work.pendingRevalidatedTags??[]).toEqual([]);
  }
  form.set("confirmed","true");
  for(const subject of [null,"close-viewer"]) {
    const denied=await withSession(subject,()=>finalizeStatements({status:"idle"},form));
    expect(denied.result).toEqual({status:"error"});expect(denied.work.pendingRevalidatedTags??[]).toEqual([]);
  }
  const response=await withSession("close-finance",()=>finalizeStatement({status:"idle"},form));
  expect(response.result).toEqual({status:"finalized",count:1});
  expect(response.work.pendingRevalidatedTags.map((entry:{tag:string})=>entry.tag)).toEqual(["_N_T_/cierre","_N_T_/estados-de-cuenta","_N_T_/tarifas","_N_T_/estados-de-cuenta/layout"]);
  const final=renderToStaticMarkup(await page("close-finance"));
  expect(final).toContain(">Final</span>");expect(final).not.toContain("Finalize period drafts");expect(final).not.toContain('name="statementId"');
  expect(final.match(/data-testid="tile_drafts"[\s\S]*?<\/div>/)?.[0]).toContain(">0</dd>");
  expect(final.match(/data-testid="tile_finals"[\s\S]*?<\/div>/)?.[0]).toContain(">1</dd>");
  expect(final.match(/data-testid="tile_group_total"[\s\S]*?<\/div>/)?.[0]).toContain(">62.00</dd>");
  for(const [status,visible] of [["draft",false],["final",true]] as const) {
    const list=await withSession("close-finance",()=>StatementsPage({searchParams:Promise.resolve({period:"2026-01",status})}));
    expect(renderToStaticMarkup(list.result).includes(`data-testid="statement-${row.id}"`)).toBe(visible);
  }

  expect((await data.owner.query(`SELECT public.rate_card_is_locked(r) AS locked FROM rate_card r`)).rows).toEqual([{locked:true}]);
  const retry=await withSession("close-admin",()=>finalizeStatements({status:"idle"},form));
  expect(retry.result).toEqual({status:"finalized",count:0});
  expect(retry.work.pendingRevalidatedTags.map((entry:{tag:string})=>entry.tag)).toContain("_N_T_/estados-de-cuenta/layout");
});

// US-039: signed sessions exercise the actual action and selected-period page composition.
test("rollup page reuses the selected group sum and export action resolves genuine finance sessions",async()=>{
 const form=new FormData();form.set("period","2026-01");
 await withSession("close-finance",()=>runClose({status:"idle"},form));
 const html=renderToStaticMarkup(await page("close-finance"));
 expect(html).toContain('data-testid="rollup_panel"');expect(html).toContain('data-testid="tile_group_total"');
 expect(html).toContain('/conciliacion?period=2026-01');expect(html).toContain('data-testid="btn_export_rollup_csv"');
 const {exportRollupCsv}=await import("@/modules/close/rollup-actions");
 const download=await withSession("close-finance",()=>exportRollupCsv("2026-01"));
 expect(download.result.filename).toBe("rollup-2026-01.csv");expect(download.result.csv).toContain("62.00");
 expect((await withSession("close-finance",()=>exportRollupCsv("2026-02"))).result.csv).not.toContain("62.00");
 for(const subject of [null,"close-viewer"])await expect(withSession(subject,()=>exportRollupCsv("2026-01"))).rejects.toThrow("ROLLUP_FORBIDDEN");
});
