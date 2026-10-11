import "next/dist/server/node-environment";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire, registerHooks } from "node:module";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { createUsageFixture, usageIds } from "@/modules/usage/testing/fixture-transaction";
import en from "../../../../messages/en-US.json";
import es from "../../../../messages/es-EC.json";
const require = createRequire(import.meta.url);
let productionPool: pg.Pool;
let localePool: pg.Pool;
let UsagePage: typeof import("./page").default;
let hooks: ReturnType<typeof registerHooks>;
let data: Awaited<ReturnType<typeof createUsageFixture>>;
const saved = vi.hoisted(() => {
  const original = { AUTH_SECRET: process.env.AUTH_SECRET, AUTH_URL: process.env.AUTH_URL, AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST, DATABASE_URL: process.env.DATABASE_URL, DB_DRIVER: process.env.DB_DRIVER };
  process.env.AUTH_SECRET = "us072-genuine-signed-session-fixture-secret";
  process.env.AUTH_URL = "http://localhost:3000";
  process.env.AUTH_TRUST_HOST = "true";
  return original;
});
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  data = await createUsageFixture();
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
    if (["/modules/usage/", "/components/usage/", "/app/(authenticated)/uso/"].some(path => decodeURI(url).includes(path))) throw new Error("Scored usage modules must remain Vitest-loaded");
    if (url.startsWith(new URL("../../../../../../", import.meta.url).href) && /\.tsx?$/.test(url)) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    }
    if (url.startsWith(new URL("../../../../messages/", import.meta.url).href) && url.endsWith(".json")) return { format: "module", shortCircuit: true, source: "export default " + readFileSync(new URL(url), "utf8") };
    return nextLoad(url, context);
  } });
  UsagePage = (await import(require.resolve("./page.tsx"))).default;
  productionPool = ((await import(require.resolve("@smp/db"))).db as unknown as { $client: pg.Pool }).$client;
  process.env.AUTH_SECRET = "us072-genuine-signed-session-fixture-secret";
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
async function page(subject: string | null, query: Record<string, string | string[] | undefined> = {}) {
  const { encode } = await import(require.resolve("next-auth/jwt"));
  const token = subject ? await encode({ secret: process.env.AUTH_SECRET!, salt: "authjs.session-token", token: { idpSubject: subject, displayName: "Verified usage fixture" } }) : null;
  const { createRequestStoreForAPI } = require("next/dist/server/async-storage/request-store");
  const { createWorkStore } = require("next/dist/server/async-storage/work-store");
  const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");
  const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external");
  const url = new URL("http://localhost:3000/uso");
  const request = new Request(url, { headers: { host: url.host, ...(token ? { cookie: "authjs.session-token=" + token } : {}) } });
  const store = createRequestStoreForAPI(request, url, { tags: [], expirationsByCacheKind: new Map() });
  const work = createWorkStore({ page: "/uso/page", renderOpts: { supportsDynamicResponse: true, isDraftMode: false }, isPrefetchRequest: false, buildId: "us072-fixture", previouslyRevalidatedTags: [] });
  return workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, () => UsagePage({ searchParams: Promise.resolve(query) })));
}
test.each([null, "usage-viewer"])("actual %s session redirects before protected page data", async subject => {
  for (const query of [{}, { window: "31" }]) await expect(page(subject, query)).rejects.toMatchObject({ digest: expect.stringContaining(";/acceso-denegado;") });
});
test("actual signed admin receives localized scoped data and invalid filters are recoverable", async () => {
  await data.owner.query("UPDATE user_account SET ui_language='en' WHERE id=$1", [usageIds.admin]);
  const html = renderToStaticMarkup(await page("usage-admin", { companyId: usageIds.companyA, window: "60" }));
  expect(html).toContain(en.usage.title);
  expect(html).toContain("Last known Ana");
  // US-073: the actual signed-admin page must wire the proposal action into its table.
  expect(html).toContain('data-testid="btn_propose_reclamation" disabled=""');
  expect(html).toContain(`data-testid="select_person_${usageIds.old}"`);
  expect(html).not.toContain("Foreign Bea");
  expect(html).toContain('value="60" selected=""');
  await data.owner.query("UPDATE user_account SET ui_language='es' WHERE id=$1", [usageIds.admin]);
  const invalid = renderToStaticMarkup(await page("usage-admin", { window: "31" }));
  expect(invalid).toContain(es.usage.invalidFilter);
  expect(invalid).toContain(es.usage.title);
  expect(invalid).toContain(`>${es.usage.apply}</a>`);
  expect(invalid).toContain('href="/uso"');
  expect(invalid).not.toContain("Last known Ana");
});
test("scoped missing company redirects and infrastructure failures propagate", async () => {
  await expect(page("usage-admin", { companyId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ digest: expect.stringContaining(";/acceso-denegado;") });
  await data.owner.query("ALTER TABLE activity_record RENAME TO usage_unavailable_activity");
  try { await expect(page("usage-admin")).rejects.toMatchObject({ code: "42P01" }); }
  finally { await data.owner.query("ALTER TABLE usage_unavailable_activity RENAME TO activity_record"); }
});
