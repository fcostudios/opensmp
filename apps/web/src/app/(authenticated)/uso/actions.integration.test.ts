import "next/dist/server/node-environment";
import { createRequire, registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import type pg from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, reclamationProposal } from "@smp/db/schema";
import { createReclamationFixture } from "@/modules/usage/testing/reclamation-fixture";

const require = createRequire(import.meta.url);
let f: Awaited<ReturnType<typeof createReclamationFixture>>;
let propose: typeof import("./actions").proposeReclamations;
let pool: pg.Pool;
let hooks: ReturnType<typeof registerHooks>;
const saved = vi.hoisted(() => {
  const original = { AUTH_SECRET: process.env.AUTH_SECRET, AUTH_URL: process.env.AUTH_URL, AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST, DATABASE_URL: process.env.DATABASE_URL, DB_DRIVER: process.env.DB_DRIVER };
  process.env.AUTH_SECRET = "us073-genuine-signed-session-fixture-secret";
  process.env.AUTH_URL = "http://localhost:3000";
  process.env.AUTH_TRUST_HOST = "true";
  return original;
});
beforeAll(async () => {
  f = await createReclamationFixture({ extraAssignment: false });
  process.env.DATABASE_URL = f.fixture.appUrl;
  process.env.DB_DRIVER = "pg";
  hooks = registerHooks({ resolve(specifier, context, nextResolve) {
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
    if (decodeURI(url).includes("/modules/usage/") || decodeURI(url).includes("/app/(authenticated)/uso/")) throw new Error("Scored usage action modules must remain Vitest-loaded");
    if (url.startsWith(new URL("../../../../../../", import.meta.url).href) && /\.tsx?$/.test(url)) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return nextLoad(url, context);
  } });
  propose = (await import("./actions")).proposeReclamations;
  pool = ((await import("@smp/db")).db as unknown as { $client: pg.Pool }).$client;
});
afterAll(async () => {
  hooks?.deregister();
  await pool?.end(); await f?.stop();
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
async function submit(subject: string | null, input: unknown) {
  const { encode } = await import("next-auth/jwt");
  const token = subject ? await encode({ secret: process.env.AUTH_SECRET!, salt: "authjs.session-token", token: { idpSubject: subject, displayName: "Verified reclamation fixture" } }) : null;
  const { createRequestStoreForAPI } = require("next/dist/server/async-storage/request-store");
  const { createWorkStore } = require("next/dist/server/async-storage/work-store");
  const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");
  const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external");
  const { IncrementalCache } = require("next/dist/server/lib/incremental-cache");
  const url = new URL("http://localhost:3000/uso");
  const request = new Request(url, { headers: { host: url.host, ...(token ? { cookie: "authjs.session-token=" + token } : {}) } });
  const store = createRequestStoreForAPI(request, url, { tags: [], expirationsByCacheKind: new Map() });
  const incrementalCache = new IncrementalCache({ dev: true, requestHeaders: {}, getPrerenderManifest: () => ({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: {} }) });
  const work = createWorkStore({ page: "/uso/page", renderOpts: { supportsDynamicResponse: true, isDraftMode: false, incrementalCache }, isPrefetchRequest: false, buildId: "us073-fixture", previouslyRevalidatedTags: [] });
  const result = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, () => propose(input)));
  return { result, work };
}
test("exported production action verifies signed identity, commits proposals/audits and revalidates uso", async () => {
  const command = { person_ids: [f.ids.person1, f.ids.person2, f.ids.person3], note: "production action", client_request_id: f.ids.command1 };
  for (const subject of [null, "reclamation-viewer", "reclamation-finance", "unknown-subject"]) {
    expect((await submit(subject, command)).result).toEqual({ status: "error", code: "access_denied" });
  }
  expect(await f.database.select().from(reclamationProposal)).toHaveLength(0);
  const { result, work } = await submit("reclamation-admin", command);
  expect(result).toEqual({ status: "success", created: 3, existing: 0 });
  expect(work.pendingRevalidatedTags).toEqual([{ tag: "_N_T_/uso", profile: undefined }]);
  const proposals = await f.database.select().from(reclamationProposal);
  expect(proposals.map(p => p.assignmentId).sort()).toEqual(f.ids.openSelectedAssignments.slice().sort());
  expect(proposals.every(p => p.proposedBy === f.ids.admin && p.proposalNote === command.note)).toBe(true);
  const audits = await f.database.select().from(auditLog).where(eq(auditLog.action, "reclamation.proposed"));
  expect(audits).toHaveLength(3);
  expect(audits.every(a => a.actorUserId === f.ids.admin)).toBe(true);
  expect((await submit("reclamation-admin", { ...command, company_id: f.ids.companyA })).result).toEqual({ status: "error", code: "access_denied" });
  expect(await f.database.select().from(reclamationProposal)).toEqual(proposals);
});
