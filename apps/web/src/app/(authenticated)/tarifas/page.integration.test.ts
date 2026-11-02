import "next/dist/server/node-environment";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire, registerHooks } from "node:module";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import pg from "pg";

const require = createRequire(import.meta.url);
let productionPool: pg.Pool;
let localePool: pg.Pool;
let RatesPage: typeof import("./page").default;
let saveRate: typeof import("@/modules/vendor-catalog/actions/manage-rates").saveRateCard;
let hooks: ReturnType<typeof registerHooks>;
let data: Awaited<ReturnType<typeof createRatesFixture>>;
const saved = vi.hoisted(() => {
  const original = { AUTH_SECRET: process.env.AUTH_SECRET, AUTH_URL: process.env.AUTH_URL, AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST, DATABASE_URL: process.env.DATABASE_URL, DB_DRIVER: process.env.DB_DRIVER };
  process.env.AUTH_SECRET = "us032-genuine-signed-session-fixture-secret";
  process.env.AUTH_URL = "http://localhost:3000";
  process.env.AUTH_TRUST_HOST = "true";
  return original;
});
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  data = await createRatesFixture();
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
    if (["/modules/vendor-catalog/rate", "/modules/vendor-catalog/actions/manage-rates", "/app/(authenticated)/tarifas/"].some(path => decodeURI(url).includes(path))) throw new Error("Scored usage modules must remain Vitest-loaded");
    if (url.startsWith(new URL("../../../../../../", import.meta.url).href) && /\.tsx?$/.test(url)) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    }
    if (url.startsWith(new URL("../../../../messages/", import.meta.url).href) && url.endsWith(".json")) return { format: "module", shortCircuit: true, source: "export default " + readFileSync(new URL(url), "utf8") };
    return nextLoad(url, context);
  } });
  RatesPage = (await import(require.resolve("./page.tsx"))).default;
  saveRate = (await import("@/modules/vendor-catalog/actions/manage-rates")).saveRateCard;
  productionPool = ((await import(require.resolve("@smp/db"))).db as unknown as { $client: pg.Pool }).$client;
  process.env.AUTH_SECRET = "us032-genuine-signed-session-fixture-secret";
  process.env.AUTH_URL = "http://localhost:3000";
  process.env.AUTH_TRUST_HOST = "true";
});
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
  const url = new URL("http://localhost:3000/tarifas");
  const request = new Request(url, { headers: { host: url.host, ...(token ? { cookie: "authjs.session-token=" + token } : {}) } });
  const store = createRequestStoreForAPI(request, url, { tags: [], expirationsByCacheKind: new Map() });
  const { IncrementalCache } = require("next/dist/server/lib/incremental-cache");
  const incrementalCache = new IncrementalCache({ dev: true, requestHeaders: {}, getPrerenderManifest: () => ({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: {} }) });
  const work = createWorkStore({ page: "/tarifas/page", renderOpts: { supportsDynamicResponse: true, isDraftMode: false, incrementalCache }, isPrefetchRequest: false, buildId: "us032-fixture", previouslyRevalidatedTags: [] });
  const result = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, run));
  return { result, work };
}

async function page(subject: string | null) { return (await withSession(subject, () => RatesPage())).result; }

async function createRatesFixture() {
  const fixture = await createPostgresFixture(); await fixture.migrate();
  const owner = await fixture.connectAsOwner();
  const id = (n: number) => `32100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await owner.query(`INSERT INTO user_account (id,email,idp_subject,global_role,status,created_at)
    VALUES ($1,'finance@rates.invalid','rates-finance','central_finance','active','2026-11-01'),
    ($2,'viewer@rates.invalid','rates-viewer',NULL,'active','2026-11-01'),
    ($3,'admin@rates.invalid','rates-admin','group_admin','active','2026-11-01')`, [id(1),id(2),id(6)]);
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
  return { fixture, owner, stop: async () => { await owner.end(); await fixture.stop(); } };
}

test.each([null, "rates-viewer"])("actual %s session cannot read global finance rates", async subject => {
  await expect(page(subject)).rejects.toMatchObject({ digest: expect.stringContaining(";/acceso-denegado;") });
});
test.each(["rates-finance", "rates-admin"])("actual signed %s session renders rates and capacity", async subject => {
  const html = renderToStaticMarkup(await page(subject));
  expect(html).toContain("Native pilot org"); expect(html).toContain("Native seat");
  expect(html).toContain("$62.00"); expect(html).toContain("Provisional");
  expect(html).toContain("140"); expect(html).toContain('data-testid="rates_table"');
  expect(html).toContain('data-testid="capacity_table"');
  expect(html).toContain('data-testid="btn_save_rate"');
});
test("infrastructure failures reach the route error boundary instead of becoming empty data", async () => {
  await data.owner.query("ALTER TABLE rate_card RENAME TO unavailable_rate_card");
  try { await expect(page("rates-finance")).rejects.toMatchObject({ code: "42P01" }); }
  finally { await data.owner.query("ALTER TABLE unavailable_rate_card RENAME TO rate_card"); }
});

test("production saveRateCard verifies signed identity and commits only authorized audited changes", async () => {
  const form = new FormData();
  const values = { vendorAccountId: "32100000-0000-4000-8000-000000000004", licenseTypeId: "32100000-0000-4000-8000-000000000005", monthlyRateUsd: "65.25", effectiveFrom: "2026-01-01", effectiveTo: "", provisional: "on" };
  for (const [key,value] of Object.entries(values)) form.set(key,value);
  for (const subject of [null,"rates-viewer"]) {
    const response = await withSession(subject, () => saveRate({ status: "idle" },form));
    expect(response.result).toEqual({ status: "error" });
    expect(response.work.pendingRevalidatedTags ?? []).toEqual([]);
  }
  const row = (await data.owner.query("SELECT id FROM rate_card")).rows[0];
  form.set("id",row.id);
  const response = await withSession("rates-finance", () => saveRate({ status: "idle" },form));
  expect(response.result).toEqual({ status: "success", id: row.id });
  expect(response.work.pendingRevalidatedTags).toEqual([{ tag: "_N_T_/tarifas", profile: undefined }]);
  expect((await data.owner.query("SELECT monthly_rate_usd FROM rate_card WHERE id=$1",[row.id])).rows[0].monthly_rate_usd).toBe("65.25");
  expect((await data.owner.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1 AND action='rate.saved'",[row.id])).rows[0].n).toBe(1);
});
