import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decryptCredential, encryptCredential } from "@smp/db/credential-crypto";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import { parseCredentialEnvelope, serializeCredentialEnvelope } from "@smp/domain";

import { createMembershipPollJob } from "./membership-poll.js";
import * as membershipPoll from "./membership-poll.js";

const id = (suffix: string) => `26600000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"), companyA: id("2"), companyB: id("3"), personA: id("4"), personB: id("5"),
  vendor: id("6"), accountA: id("7"), accountB: id("8"), license: id("9"),
  requestA: id("10"), requestB: id("11"), actionA: id("12"), actionB: id("13"),
};
const at = new Date("2026-09-09T04:30:00.000Z");
const kek = Uint8Array.from({ length: 32 }, (_, index) => index);
const deterministicBytes = (length: number) => Uint8Array.from({ length }, (_, index) => (index + length) % 256);

let fixture: PostgresFixture;
let owner: pg.Client;
let privateRoot: string;
let kekFile: string;

function namedConnection(name: string): string {
  const url = new URL(fixture.appUrl);
  url.searchParams.set("application_name", name);
  return url.toString();
}

async function assertReleased(applicationName: string): Promise<void> {
  const monitor = await fixture.connectAsApp();
  try {
    const sessions = await monitor.query("SELECT state FROM pg_stat_activity WHERE application_name=$1 ORDER BY pid", [applicationName]);
    expect(sessions.rows).toEqual([{ state: "idle" }, { state: "idle" }]);
    const acquired = await monitor.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired", [ids.actionA]);
    expect(acquired.rows).toEqual([{ acquired: true }]);
    await monitor.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [ids.actionA]);
  } finally { await monitor.end(); }
}

async function credential(secret: string): Promise<string> {
  return serializeCredentialEnvelope(await encryptCredential(secret, kek, deterministicBytes));
}

async function seed(): Promise<void> {
  await owner.query(`TRUNCATE TABLE audit_log,connector_call_observation,request_transition,provisioning_action,
    license_assignment,license_request,integration_credential,license_type,vendor_account,vendor,person,company,user_account RESTART IDENTITY CASCADE`);
  await owner.query(`INSERT INTO user_account (id,email,idp_subject,global_role,ui_language,status,created_at)
    VALUES ($1,'admin@poll.test','poll-admin','group_admin','en','active',$2)`, [ids.admin, at]);
  await owner.query(`INSERT INTO company (id,name,code,type,status,statement_language,created_at,created_by)
    VALUES ($1,'A','POLA','internal','active','en',$3,$4),($2,'B','POLB','external','active','en',$3,$4)`, [ids.companyA, ids.companyB, at, ids.admin]);
  await owner.query(`INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by)
    VALUES ($1,'accepted@poll.test','A',$3,'active',$5,$6),($2,'same@poll.test','B',$4,'active',$5,$6)`, [ids.personA, ids.personB, ids.companyA, ids.companyB, at, ids.admin]);
  await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
    VALUES ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$2,$3)`, [ids.vendor, at, ids.admin]);
  await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
    VALUES ($1,$3,'A','automated',1,'active',$4,$5),($2,$3,'B','automated',1,'active',$4,$5)`, [ids.accountA, ids.accountB, ids.vendor, at, ids.admin]);
  await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
    VALUES ($1,$2,'Seat','seat','active',$3,$4)`, [ids.license, ids.vendor, at, ids.admin]);
  await owner.query(`INSERT INTO license_request (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by,updated_at)
    VALUES ($1,'POL-A',$3,$5,$7,$9,'invited','A',$10,$11,$10),($2,'POL-B',$4,$6,$8,$9,'invited','B',$10,$11,$10)`, [ids.requestA, ids.requestB, ids.personA, ids.personB, ids.companyA, ids.companyB, ids.accountA, ids.accountB, ids.license, at, ids.admin]);
  await owner.query(`INSERT INTO provisioning_action (id,request_id,vendor_account_id,kind,mode,status,sent_at,created_at)
    VALUES ($1,$3,$5,'invite','automated','sent',$7,$7),($2,$4,$6,'invite','automated','sent',$7,$7)`, [ids.actionA, ids.actionB, ids.requestA, ids.requestB, ids.accountA, ids.accountB, at]);
  await owner.query("UPDATE license_request SET requested_by=$1", [ids.admin]);
  await owner.query(`INSERT INTO integration_credential (vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by)
    VALUES ($1,'admin_scoped',$2,'ok','active',$4,$5),($1,'analytics',$3,'ok','active',$4,$5)`,
  [ids.accountA, await credential("admin-secret"), await credential("analytics-secret"), at, ids.admin]);
}

function pageTransport(active: boolean) {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/users")) return new Response(JSON.stringify({
      data: active ? [{ type: "user", id: "provider-user", name: "Accepted", email: "accepted@poll.test" }] : [],
      has_more: false, first_id: active ? "provider-user" : null, last_id: active ? "provider-user" : null,
    }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  privateRoot = await mkdtemp(join(tmpdir(), "ledger-us066-"));
  kekFile = join(privateRoot, "credential-kek");
  await writeFile(kekFile, `${Buffer.from(kek).toString("base64")}\n`, "utf8");
  await chmod(kekFile, 0o400);
}, 120_000);

afterAll(async () => {
  await owner?.end();
  await fixture?.stop();
  if (privateRoot) await rm(privateRoot, { recursive: true });
});

describe("US-066 accepted invitation membership poll", () => {
  it("activates only the accepted tenant request once with sanitized evidence", async () => {
    // Mutations killed: skipping sent/invited guards, tenant/account predicates, assignment pointer,
    // or the canonical transition creates a false activation or a duplicate seat.
    await seed();
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(true) });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 1 });
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    const activated = await owner.query(`SELECT request.state,request.license_assignment_id,action.status,action.raw_response,
      assignment.person_id,assignment.company_id,assignment.vendor_account_id,assignment.started_on,assignment.source_request_id,assignment.source_kind
      FROM license_request request JOIN provisioning_action action ON action.request_id=request.id
      LEFT JOIN license_assignment assignment ON assignment.id=request.license_assignment_id WHERE request.id=$1`, [ids.requestA]);
    expect(activated.rows).toEqual([{
      state: "active", license_assignment_id: expect.any(String), status: "confirmed",
      raw_response: { membershipPoll: { cursor: null, pageCount: 1, memberSetSize: 1, complete: false } },
      person_id: ids.personA, company_id: ids.companyA, vendor_account_id: ids.accountA,
      started_on: new Date("2026-09-08T05:00:00.000Z"), source_request_id: ids.requestA, source_kind: "request",
    }]);
    const counts = await owner.query(`SELECT (SELECT count(*)::int FROM license_assignment WHERE source_request_id=$1) AS assignments,
      (SELECT count(*)::int FROM request_transition WHERE request_id=$1 AND from_state='invited' AND to_state='active') AS transitions,
      (SELECT count(*)::int FROM audit_log WHERE entity_id=$1 AND action='request.active') AS audits`, [ids.requestA]);
    expect(counts.rows).toEqual([{ assignments: 1, transitions: 1, audits: 1 }]);
    expect((await owner.query("SELECT request_id,company_id,kind,recipient_user_account_id,recipient_email,recipient_locale,request_state,created_at FROM lifecycle_notification")).rows).toEqual([{
      request_id: ids.requestA, company_id: ids.companyA, kind: "provisioning_complete",
      recipient_user_account_id: ids.admin, recipient_email: "admin@poll.test", recipient_locale: "en", request_state: "active", created_at: at,
    }]);
    expect((await owner.query("SELECT note FROM request_transition WHERE request_id=$1", [ids.requestA])).rows).toEqual([{ note: "Membership poll accepted invitation" }]);
    const foreign = await owner.query(`SELECT request.state,action.status FROM license_request request JOIN provisioning_action action ON action.request_id=request.id WHERE request.id=$1`, [ids.requestB]);
    expect(foreign.rows).toEqual([{ state: "invited", status: "sent" }]);
  });

  it("leaves an invited request untouched until an active member is observed", async () => {
    // Mutation killed: treating a pending invitation or empty member page as acceptance activates before provider evidence.
    await seed();
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(false) });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
      const checkpoint = await owner.query(`SELECT raw_response FROM provisioning_action WHERE id=$1`, [ids.actionA]);
      expect(checkpoint.rows[0]).toEqual({ raw_response: { membershipPoll: { cursor: null, pageCount: 2, memberSetSize: 0, complete: true } } });
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally { await job.close(); }
    const state = await owner.query(`SELECT request.state,request.license_assignment_id,action.status,action.raw_response
      FROM license_request request JOIN provisioning_action action ON action.request_id=request.id WHERE request.id=$1`, [ids.requestA]);
    expect(state.rows).toEqual([{ state: "invited", license_assignment_id: null, status: "sent", raw_response: { membershipPoll: { cursor: null, pageCount: 2, memberSetSize: 0, complete: true } } }]);
    const nextPoll = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(true) });
    try {
      await expect(nextPoll.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 1 });
    } finally { await nextPoll.close(); }
  });

  it("finds an accepted member on the second page within the same scheduled drain", async () => {
    // Returning after a normal first page delays acceptance by another scheduled interval.
    await seed();
    const continuations: (string | null)[] = [];
    const transport = async (request: Request) => {
      const url = new URL(request.url);
      if (!url.pathname.endsWith("/users")) return new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), { status: 200, headers: { "content-type": "application/json" } });
      const continuation = url.searchParams.get("after_id");
      continuations.push(continuation);
      return new Response(JSON.stringify(continuation === null
        ? { data: [{ type: "user", id: "page-one", name: "Other", email: "other@poll.test" }], has_more: true, first_id: "page-one", last_id: "page-one" }
        : { data: [{ type: "user", id: "page-two", name: "Accepted", email: "accepted@poll.test" }], has_more: false, first_id: "page-two", last_id: "page-two" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 1 });
    } finally { await job.close(); }
    expect(continuations).toEqual([null, "page-one"]);
    const state = await owner.query(`SELECT request.state,action.status,action.raw_response
      FROM license_request request JOIN provisioning_action action ON action.request_id=request.id WHERE request.id=$1`, [ids.requestA]);
    expect(state.rows).toEqual([{ state: "active", status: "confirmed", raw_response: { membershipPoll: { cursor: null, pageCount: 2, memberSetSize: 2, complete: false } } }]);
  });

  it("resumes the saved second-page cursor after an actual provider interruption", async () => {
    await seed();
    const continuations: (string | null)[] = [];
    let interrupt = true;
    const transport = async (request: Request) => {
      const continuation = new URL(request.url).searchParams.get("after_id");
      continuations.push(continuation);
      if (continuation !== null && interrupt) {
        interrupt = false;
        return new Response(JSON.stringify({ error: { type: "permission_error", message: "interrupted" } }), { status: 403, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(continuation === null
        ? { data: [{ type: "user", id: "page-one", name: "Other", email: "other@poll.test" }], has_more: true, first_id: "page-one", last_id: "page-one" }
        : { data: [{ type: "user", id: "page-two", name: "Accepted", email: "accepted@poll.test" }], has_more: false, first_id: "page-two", last_id: "page-two" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
      const checkpoint = await owner.query("SELECT raw_response FROM provisioning_action WHERE id=$1", [ids.actionA]);
      expect(checkpoint.rows[0]).toMatchObject({ raw_response: { membershipPoll: { cursor: { stream: "members", pageCount: 1, memberSetSize: 1 }, pageCount: 1, memberSetSize: 1, complete: false, resume: expect.any(String) } } });
      expect(continuations).toEqual([null, "page-one"]);
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 1 });
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally { await job.close(); }
    expect(continuations).toEqual([null, "page-one", "page-one"]);
    const counts = await owner.query("SELECT count(*)::int AS assignments FROM license_assignment WHERE source_request_id=$1", [ids.requestA]);
    expect(counts.rows).toEqual([{ assignments: 1 }]);
  });

  it("rejects malformed or foreign encrypted checkpoints before another provider request", async () => {
    // Mutations killed: permissive checkpoint parsing leaks a cursor across accounts or resumes with forged public evidence.
    const variants = ["not-an-object", "terminal-checkpoint", "foreign-resume"] as const;
    for (const variant of variants) {
      await seed();
      const writer = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined,
        transport: async (request) => new URL(request.url).pathname.endsWith("/users") ? pageTransport(false)(request)
          : new Response(JSON.stringify({ error: { type: "permission_error", message: "interrupted" } }), { status: 403, headers: { "content-type": "application/json" } }) });
      try { await writer.drain({ at, vendorAccountId: ids.accountA }); } finally { await writer.close(); }
      const stored = await owner.query<{ rawResponse: { membershipPoll: { resume: string } } }>("SELECT raw_response AS \"rawResponse\" FROM provisioning_action WHERE id=$1", [ids.actionA]);
      const original = stored.rows[0]!.rawResponse;
      let forged: unknown = original;
      if (variant === "not-an-object") forged = [];
      if (variant === "terminal-checkpoint") forged = { membershipPoll: { ...original.membershipPoll, complete: true } };
      if (variant === "foreign-resume") {
        const decrypted = JSON.parse(await decryptCredential(parseCredentialEnvelope(original.membershipPoll.resume), kek)) as Record<string, unknown>;
        const resume = serializeCredentialEnvelope(await encryptCredential(JSON.stringify({ ...decrypted, vendorAccountId: ids.accountB }), kek, deterministicBytes));
        forged = { membershipPoll: { ...original.membershipPoll, resume } };
      }
      await owner.query("UPDATE provisioning_action SET raw_response=$2::jsonb WHERE id=$1", [ids.actionA, JSON.stringify(forged)]);
      let calls = 0;
      const reader = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: async () => { calls += 1; throw new Error("provider must not run"); } });
      try {
        await expect(reader.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
      } finally { await reader.close(); }
      expect(calls).toBe(0);
    }
  });

  it("retains a valid checkpoint when the total page budget is exhausted and can retry without poison", async () => {
    await seed();
    const cursor = { stream: "members", pageCount: 99, memberSetSize: 0 };
    const resume = await credential(JSON.stringify({ ...cursor, vendorAccountId: ids.accountA, continuation: "page99", seenContinuations: ["page99"] }));
    const saved = { membershipPoll: { cursor, complete: false, pageCount: 99, memberSetSize: 0, resume } };
    await owner.query("UPDATE provisioning_action SET raw_response=$2::jsonb WHERE id=$1", [ids.actionA, JSON.stringify(saved)]);
    const requests: string[] = [];
    const job = createMembershipPollJob({ connectionString: fixture.appUrl, allowedKekRoot: privateRoot, kekFile, now: () => at, sleep: async () => undefined,
      transport: async (request) => { requests.push(new URL(request.url).searchParams.get("after_id")!); return pageTransport(false)(request); } });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
      expect((await owner.query("SELECT raw_response FROM provisioning_action WHERE id=$1", [ids.actionA])).rows).toEqual([{ raw_response: saved }]);
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally { await job.close(); }
    expect(requests).toEqual(["page99", "page99"]);
  });

  it("rejects invalid poll inputs before selecting a tenant or contacting the provider", async () => {
    // Mutations killed: accepting a bad timestamp, account id, or KEK path makes the scheduler bypass its safety boundary.
    await seed();
    let calls = 0;
    const configured = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: async () => { calls += 1; throw new Error("provider must not run"); } });
    try {
      await expect(configured.drain({ at: new Date(Number.NaN), vendorAccountId: ids.accountA })).rejects.toThrow("MEMBERSHIP_POLL_TIME_INVALID");
      await expect(configured.drain({ at, vendorAccountId: "not-a-uuid" })).rejects.toThrow("MEMBERSHIP_POLL_VENDOR_INVALID");
      await expect(configured.drain({ at, vendorAccountId: `prefix-${ids.accountA}` })).rejects.toThrow("MEMBERSHIP_POLL_VENDOR_INVALID");
      await expect(configured.drain({ at, vendorAccountId: `${ids.accountA}-suffix` })).rejects.toThrow("MEMBERSHIP_POLL_VENDOR_INVALID");
    } finally { await configured.close(); }
    const missingKek = createMembershipPollJob({ connectionString: fixture.appUrl, now: () => at, sleep: async () => undefined, transport: async () => { calls += 1; throw new Error("provider must not run"); } });
    try { await expect(missingKek.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow("LEDGER_CREDENTIAL_KEK_FILE is required"); } finally { await missingKek.close(); }
    expect(calls).toBe(0);
  });

  it("releases the action lock before close and closes both real database pools", async () => {
    // Mutations removing unlock or either owned-pool close must leave observable sessions or a held action lock.
    await seed();
    const name = "us066-close-contract";
    const job = createMembershipPollJob({ connectionString: namedConnection(name), allowedKekRoot: privateRoot, kekFile: ` ${kekFile} `, now: () => at, sleep: async () => undefined, transport: pageTransport(true) });
    let closed = false;
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 1 });
      await assertReleased(name);
      expect((await owner.query("SELECT DISTINCT occurred_at FROM connector_call_observation WHERE vendor_account_id=$1", [ids.accountA])).rows).toEqual([{ occurred_at: at }]);
      await job.close();
      closed = true;
      const monitor = await fixture.connectAsApp();
      try { expect((await monitor.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1", [name])).rows).toEqual([]); }
      finally { await monitor.end(); }
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow("Cannot use a pool after calling end");
    } finally { if (!closed) await job.close(); }
  });

  it("uses account-bound credentials for an all-account drain without activating a same-email request in another account", async () => {
    // Global email uniqueness requires reusing the real person, not fabricating duplicate people.
    await seed();
    await owner.query("UPDATE license_request SET person_id=$2,company_id=$3 WHERE id=$1", [ids.requestB, ids.personA, ids.companyA]);
    await owner.query(`INSERT INTO integration_credential (vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by)
      VALUES ($1,'admin_scoped',$2,'ok','active',$3,$4),($1,'analytics',$5,'ok','active',$3,$4)`, [ids.accountB, await credential("account-b-secret"), at, ids.admin, await credential("account-b-analytics")]);
    const accounts: string[] = [];
    const job = createMembershipPollJob({ connectionString: fixture.appUrl, allowedKekRoot: privateRoot, kekFile, now: () => at, sleep: async () => undefined,
      transport: async (request) => {
        const secret = request.headers.get("x-api-key");
        expect(["admin-secret", "account-b-secret"]).toContain(secret);
        accounts.push(secret!);
        return pageTransport(secret === "admin-secret")(request);
      } });
    try { await expect(job.drain({ at })).resolves.toEqual({ processed: 1 }); }
    finally { await job.close(); }
    expect(accounts).toEqual(["admin-secret", "account-b-secret", "account-b-secret"]);
    const states = await owner.query("SELECT id,state,license_assignment_id FROM license_request ORDER BY request_no");
    expect(states.rows).toEqual([{ id: ids.requestA, state: "active", license_assignment_id: expect.any(String) }, { id: ids.requestB, state: "invited", license_assignment_id: null }]);
    expect((await owner.query("SELECT count(*)::int AS transitions FROM request_transition WHERE request_id=$1", [ids.requestB])).rows).toEqual([{ transitions: 0 }]);
  });

  it("enforces the provider window with the supplied clock and sleep without real waiting", async () => {
    // A broken Date-to-milliseconds adapter silently bypasses the rate window.
    await seed();
    let milliseconds = at.getTime();
    const waits: number[] = [];
    let calls = 0;
    const job = createMembershipPollJob({ connectionString: fixture.appUrl, allowedKekRoot: privateRoot, kekFile,
      now: () => new Date(milliseconds),
      sleep: async (duration) => { waits.push(duration); milliseconds += duration; },
      transport: async (request) => { calls += 1; return pageTransport(false)(request); } });
    try {
      for (let poll = 0; poll < 51; poll += 1) await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally { await job.close(); }
    expect(calls).toBe(102);
    expect(waits).toEqual([60_000]);
    expect((await owner.query("SELECT max(occurred_at) AS last FROM connector_call_observation WHERE vendor_account_id=$1", [ids.accountA])).rows).toEqual([{ last: new Date("2026-09-09T04:31:00.000Z") }]);
  });

  it("rejects the same-email request under a mismatched company even within the selected account", async () => {
    await seed();
    await owner.query("UPDATE license_request SET person_id=$2,vendor_account_id=$3 WHERE id=$1", [ids.requestB, ids.personA, ids.accountA]);
    await owner.query("UPDATE provisioning_action SET vendor_account_id=$2 WHERE id=$1", [ids.actionB, ids.accountA]);
    const job = createMembershipPollJob({ connectionString: fixture.appUrl, allowedKekRoot: privateRoot, kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(true) });
    try { await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 1 }); }
    finally { await job.close(); }
    expect((await owner.query("SELECT state,license_assignment_id FROM license_request WHERE id=$1", [ids.requestB])).rows).toEqual([{ state: "invited", license_assignment_id: null }]);
    expect((await owner.query("SELECT company_id,source_request_id FROM license_assignment")).rows).toEqual([{ company_id: ids.companyA, source_request_id: ids.requestA }]);
    expect((await owner.query("SELECT request_id FROM request_transition")).rows).toEqual([{ request_id: ids.requestA }]);
  });

  it.each([false, true])("does not create a second assignment when source evidence or a pointer already binds the request (pointer=%s)", async (linked) => {
      await seed();
      const assignment = id("50");
      await owner.query(`INSERT INTO license_assignment (id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_request_id,source_kind,created_at)
        VALUES ($1,$2,$3,$4,$5,'2026-09-08',$6,$8,$7)`, [assignment, ids.personA, ids.companyA, ids.accountA, ids.license, linked ? null : ids.requestA, at, linked ? "reconciliation" : "request"]);
      if (linked) await owner.query("UPDATE license_request SET license_assignment_id=$2 WHERE id=$1", [ids.requestA, assignment]);
      const job = createMembershipPollJob({ connectionString: fixture.appUrl, allowedKekRoot: privateRoot, kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(true) });
      try { await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 }); }
      finally { await job.close(); }
      expect((await owner.query("SELECT id FROM license_assignment")).rows).toEqual([{ id: assignment }]);
      expect((await owner.query("SELECT state,license_assignment_id FROM license_request WHERE id=$1", [ids.requestA])).rows).toEqual([{ state: "invited", license_assignment_id: linked ? assignment : null }]);
      expect((await owner.query("SELECT request_id FROM request_transition")).rows).toEqual([]);
  });

  it("does not checkpoint or activate after a provider failure or a stale request transition", async () => {
    // Mutations killed: treating a failed page as data, or writing a checkpoint after the request is no longer invited, corrupts replay evidence.
    await seed();
    const failed = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: async () => new Response("{\"error\":true}", { status: 500, headers: { "content-type": "application/json" } }) });
    try { await expect(failed.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 }); } finally { await failed.close(); }
    let before = await owner.query("SELECT raw_response FROM provisioning_action WHERE id=$1", [ids.actionA]);
    expect(before.rows).toEqual([{ raw_response: null }]);
    await owner.query("UPDATE license_request SET state='active' WHERE id=$1", [ids.requestA]);
    let calls = 0;
    const stale = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: async () => { calls += 1; return new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), { status: 200, headers: { "content-type": "application/json" } }); } });
    try { await expect(stale.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 }); } finally { await stale.close(); }
    expect(calls).toBe(0);
    before = await owner.query("SELECT raw_response FROM provisioning_action WHERE id=$1", [ids.actionA]);
    expect(before.rows).toEqual([{ raw_response: null }]);
  });

  it("serializes concurrent pollers before the provider call and creates only one assignment", async () => {
    // Mutation killed: removing the action advisory lock permits duplicate remote confirmation and duplicate seats.
    await seed();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const transport = async (request: Request) => {
      calls += 1;
      if (new URL(request.url).pathname.endsWith("/users")) {
        enter();
        if (calls === 1) await released;
        return new Response(JSON.stringify({ data: [{ type: "user", id: "provider-user", name: "Accepted", email: "accepted@poll.test" }], has_more: false, first_id: "provider-user", last_id: "provider-user" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const first = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport });
    const second = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport });
    try {
      const firstRun = first.drain({ at, vendorAccountId: ids.accountA });
      await entered;
      // Keep the first provider response blocked until the second poll has actually
      // failed to acquire the lock; releasing before awaiting this is a timing race.
      await expect(second.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
      release();
      await expect(firstRun).resolves.toEqual({ processed: 1 });
    } finally { release(); await Promise.all([first.close(), second.close()]); }
    expect(calls).toBe(1);
    const counts = await owner.query(`SELECT (SELECT count(*)::int FROM license_assignment WHERE source_request_id=$1) AS assignments,
      (SELECT count(*)::int FROM request_transition WHERE request_id=$1) AS transitions`, [ids.requestA]);
    expect(counts.rows).toEqual([{ assignments: 1, transitions: 1 }]);
    expect((await owner.query("SELECT count(*)::int AS notifications FROM lifecycle_notification WHERE request_id=$1", [ids.requestA])).rows).toEqual([{ notifications: 1 }]);
  });

  it("rolls back activation and all evidence when the lifecycle outbox insert fails", async () => {
    await seed();
    await owner.query(`CREATE FUNCTION reject_poll_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'poll outbox unavailable'; END $$;
      CREATE TRIGGER reject_poll_notification BEFORE INSERT ON lifecycle_notification FOR EACH ROW EXECUTE FUNCTION reject_poll_notification()`);
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(true) });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow();
      expect((await owner.query(`SELECT request.state,request.license_assignment_id,action.status,action.raw_response,action.resolved_at,
        (SELECT count(*)::int FROM license_assignment) AS assignments,
        (SELECT count(*)::int FROM request_transition) AS transitions,
        (SELECT count(*)::int FROM audit_log) AS audits,
        (SELECT count(*)::int FROM lifecycle_notification) AS notifications
        FROM license_request request JOIN provisioning_action action ON action.request_id=request.id WHERE request.id=$1`, [ids.requestA])).rows).toEqual([{
        state: "invited", license_assignment_id: null, status: "sent", raw_response: null, resolved_at: null,
        assignments: 0, transitions: 0, audits: 0, notifications: 0,
      }]);
    } finally {
      await job.close();
      await owner.query("DROP TRIGGER reject_poll_notification ON lifecycle_notification; DROP FUNCTION reject_poll_notification()");
    }
  });

  it("revalidates the locked request after provider I/O changes its state", async () => {
    // Without the transaction's stale-state check, the completed external call creates a seat for a deprovisioned request.
    await seed();
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: namedConnection("us066-stale-clean"), kekFile, now: () => at, sleep: async () => undefined,
      transport: async (request) => {
        await owner.query("UPDATE license_request SET state='deprovisioned' WHERE id=$1", [ids.requestA]);
        return pageTransport(true)(request);
      } });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
      await assertReleased("us066-stale-clean");
    }
    finally { await job.close(); }
    const result = await owner.query("SELECT state,license_assignment_id,(SELECT count(*)::int FROM license_assignment) AS assignments FROM license_request WHERE id=$1", [ids.requestA]);
    expect(result.rows).toEqual([{ state: "deprovisioned", license_assignment_id: null, assignments: 0 }]);
  });

  it("stops pagination when a request becomes stale before its checkpoint is saved", async () => {
    await seed();
    let calls = 0;
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined,
      transport: async (request) => {
        calls += 1;
        await owner.query("UPDATE license_request SET state='deprovisioned' WHERE id=$1", [ids.requestA]);
        return pageTransport(false)(request);
      } });
    try { await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 }); }
    finally { await job.close(); }
    expect(calls).toBe(1);
    const result = await owner.query("SELECT raw_response,status FROM provisioning_action WHERE id=$1", [ids.actionA]);
    expect(result.rows).toEqual([{ raw_response: null, status: "sent" }]);
  });

  it("rolls back the entire activation when a locked request or action update is rejected", async () => {
    // Returning no updated row must abort the seat insert rather than silently confirm a partial activation.
    for (const [table, message] of [["license_request", "MEMBERSHIP_POLL_ASSIGNMENT_CONFLICT"], ["provisioning_action", "MEMBERSHIP_POLL_ACTION_CONFLICT"]]) {
      await seed();
      await owner.query(`CREATE FUNCTION skip_membership_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
        CREATE TRIGGER skip_membership_update BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION skip_membership_update()`);
      const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: namedConnection("us066-rejected-clean"), kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(true) });
      try {
        await expect(job.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow(message);
        await assertReleased("us066-rejected-clean");
      }
      finally {
        await job.close();
        await owner.query(`DROP TRIGGER skip_membership_update ON ${table}; DROP FUNCTION skip_membership_update()`);
      }
      const result = await owner.query("SELECT state,license_assignment_id,(SELECT count(*)::int FROM license_assignment) AS assignments FROM license_request WHERE id=$1", [ids.requestA]);
      expect(result.rows).toEqual([{ state: "invited", license_assignment_id: null, assignments: 0 }]);
    }
  });

  it("retains the previous checkpoint when persisting a successful provider page fails", async () => {
    // The checkpoint transaction must rollback and propagate failure, leaving the provider page safe to replay.
    await seed();
    await owner.query(`CREATE FUNCTION reject_membership_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'checkpoint storage failure'; END $$;
      CREATE TRIGGER reject_membership_checkpoint BEFORE UPDATE ON provisioning_action FOR EACH ROW EXECUTE FUNCTION reject_membership_checkpoint()`);
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: namedConnection("us066-checkpoint-clean"), kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(false) });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow("checkpoint storage failure");
      await assertReleased("us066-checkpoint-clean");
    }
    finally {
      await job.close();
      await owner.query("DROP TRIGGER reject_membership_checkpoint ON provisioning_action; DROP FUNCTION reject_membership_checkpoint()");
    }
    const result = await owner.query("SELECT raw_response,status FROM provisioning_action WHERE id=$1", [ids.actionA]);
    expect(result.rows).toEqual([{ raw_response: null, status: "sent" }]);
  });

  it("rolls back assignment, action evidence, and lifecycle transition when finalization fails", async () => {
    // Mutation killed: committing any member of the activation unit leaves a paid seat without its canonical lifecycle state.
    await seed();
    await owner.query(`CREATE OR REPLACE FUNCTION reject_membership_poll() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced membership rollback'; END $$;
      CREATE TRIGGER reject_membership_poll BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_membership_poll()`);
    const job = createMembershipPollJob({ allowedKekRoot: privateRoot, connectionString: fixture.appUrl, kekFile, now: () => at, sleep: async () => undefined, transport: pageTransport(true) });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow("forced membership rollback");
    } finally {
      await job.close();
      await owner.query("DROP TRIGGER IF EXISTS reject_membership_poll ON audit_log; DROP FUNCTION IF EXISTS reject_membership_poll()");
    }
    const state = await owner.query(`SELECT request.state,request.license_assignment_id,action.status,action.raw_response,
      (SELECT count(*)::int FROM license_assignment WHERE source_request_id=request.id) AS assignments,
      (SELECT count(*)::int FROM request_transition WHERE request_id=request.id) AS transitions
      FROM license_request request JOIN provisioning_action action ON action.request_id=request.id WHERE request.id=$1`, [ids.requestA]);
    expect(state.rows).toEqual([{ state: "invited", license_assignment_id: null, status: "sent", raw_response: null, assignments: 0, transitions: 0 }]);
  });
});

describe("membership checkpoint trust boundary", () => {
  const cursor = { stream: "members", pageCount: 1, memberSetSize: 0 };
  async function checkpoint() {
    return { membershipPoll: { complete: false, cursor, pageCount: 1, memberSetSize: 0,
      resume: await credential(JSON.stringify({ vendorAccountId: ids.accountA })) } };
  }

  it("rejects forged checkpoint shapes and invalid cursor counters before returning provider continuation", async () => {
    // Removing any validation accepts untrusted pagination state rather than failing closed.
    const valid = await checkpoint();
    const badCursors: unknown[] = [null, [], "members", new Date(), {},
      { ...cursor, extra: "provider-secret" }, { ...cursor, stream: "unknown" },
      { ...cursor, pageCount: 0 }, { ...cursor, pageCount: 100 }, { ...cursor, pageCount: 1.5 },
      { ...cursor, pageCount: "1" }, { ...cursor, memberSetSize: -1 }, { ...cursor, memberSetSize: 0.5 },
      { ...cursor, memberSetSize: Number.MAX_SAFE_INTEGER + 1 }];
    const badRoots: unknown[] = [[], "raw", 4, undefined, new Date(), {}, { membershipPoll: [] },
      { membershipPoll: { ...valid.membershipPoll, extra: "secret" } },
      { membershipPoll: { ...valid.membershipPoll, resume: 3 } },
      { membershipPoll: { ...valid.membershipPoll, resume: [valid.membershipPoll.resume] } },
      { membershipPoll: { ...valid.membershipPoll, resume: "not-encrypted" } },
      { membershipPoll: { ...valid.membershipPoll, pageCount: 1.5 } },
      { membershipPoll: { ...valid.membershipPoll, memberSetSize: 0.5 } },
      { membershipPoll: { ...valid.membershipPoll, pageCount: 2 } },
      { membershipPoll: { ...valid.membershipPoll, memberSetSize: 1 } },
      ...[0, "false", null].map((complete) => ({ membershipPoll: { ...valid.membershipPoll, complete } })),
      ...[0, 100].map((pageCount) => ({ membershipPoll: { ...valid.membershipPoll, pageCount, cursor: { ...cursor, pageCount } } })),
      { membershipPoll: { ...valid.membershipPoll, memberSetSize: -1, cursor: { ...cursor, memberSetSize: -1 } } },
      ...badCursors.map((badCursor) => ({ membershipPoll: { ...valid.membershipPoll, cursor: badCursor } }))];
    for (const input of badRoots) {
      await expect(membershipPoll.decodeMembershipPollCheckpoint(input, ids.accountA, kek)).rejects.toThrow("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
    }
  });

  it("accepts fresh and completed scans as fresh starts and preserves valid boundary cursors", async () => {
    // Restarting a complete scan is required to discover invitations accepted after the previous scan.
    await expect(membershipPoll.decodeMembershipPollCheckpoint(null, ids.accountA, kek)).resolves.toEqual({ cursor: null, resume: null });
    await expect(membershipPoll.decodeMembershipPollCheckpoint({ membershipPoll: { complete: true, cursor: null, pageCount: 2, memberSetSize: 0 } }, ids.accountA, kek)).resolves.toEqual({ cursor: null, resume: null });
    const stored = await checkpoint();
    for (const stream of ["members", "invitations"]) {
      const boundary = { stream, pageCount: 99, memberSetSize: 0 };
      const value = { membershipPoll: { ...stored.membershipPoll, cursor: boundary, pageCount: 99 } };
      await expect(membershipPoll.decodeMembershipPollCheckpoint(value, ids.accountA, kek)).resolves.toEqual({ cursor: boundary, resume: { vendorAccountId: ids.accountA } });
    }
    const nullPrototype = Object.assign(Object.create(null), stored);
    await expect(membershipPoll.decodeMembershipPollCheckpoint(nullPrototype, ids.accountA, kek)).resolves.toMatchObject({ cursor });
  });

  it("rejects a malformed completed scan rather than silently restarting and laundering its evidence", async () => {
    const complete = { complete: true, cursor: null, pageCount: 2, memberSetSize: 0 };
    for (const malformed of [
      { ...complete, extra: "secret" }, { ...complete, cursor }, { ...complete, pageCount: 0 },
      { ...complete, pageCount: 101 }, { ...complete, pageCount: 1.5 },
      { ...complete, memberSetSize: -1 }, { ...complete, memberSetSize: 0.5 },
    ]) {
      await expect(membershipPoll.decodeMembershipPollCheckpoint({ membershipPoll: malformed }, ids.accountA, kek)).rejects.toThrow("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
    }
    for (const pageCount of [1, 100]) {
      await expect(membershipPoll.decodeMembershipPollCheckpoint({ membershipPoll: { ...complete, pageCount } }, ids.accountA, kek)).resolves.toEqual({ cursor: null, resume: null });
    }
  });

  it("rejects inherited checkpoint fields while permitting null-prototype JSON records", async () => {
    const stored = await checkpoint();
    const inheritedRoot = Object.assign(Object.create({ unexpected: true }), stored);
    const inheritedCursor = Object.assign(Object.create({ unexpected: true }), cursor);
    const inheritedStored = Object.assign(Object.create({ unexpected: true }), stored.membershipPoll);
    for (const input of [inheritedRoot, { membershipPoll: inheritedStored }, { membershipPoll: { ...stored.membershipPoll, cursor: inheritedCursor } }]) {
      await expect(membershipPoll.decodeMembershipPollCheckpoint(input, ids.accountA, kek)).rejects.toThrow("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
    }
    const nullCursor = Object.assign(Object.create(null), cursor);
    await expect(membershipPoll.decodeMembershipPollCheckpoint({ membershipPoll: { ...stored.membershipPoll, cursor: nullCursor } }, ids.accountA, kek)).resolves.toMatchObject({ cursor });
  });

  it("rejects decrypted data that is not an account-bound object", async () => {
    const stored = await checkpoint();
    for (const decrypted of ["not-json", "null", "[]", '"text"', JSON.stringify({ vendorAccountId: ids.accountB })]) {
      const value = { membershipPoll: { ...stored.membershipPoll, resume: await credential(decrypted) } };
      await expect(membershipPoll.decodeMembershipPollCheckpoint(value, ids.accountA, kek)).rejects.toThrow("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
    }
  });
});
