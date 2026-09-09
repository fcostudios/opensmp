import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encryptCredential } from "@smp/db/credential-crypto";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { serializeCredentialEnvelope } from "@smp/domain";

import { createAutomatedInviteDeliveryJob } from "./automated-invite-delivery.js";

const id = (suffix: string) => `26300000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"),
  companyA: id("2"),
  companyB: id("3"),
  personA: id("4"),
  personB: id("5"),
  vendor: id("6"),
  accountA: id("7"),
  accountB: id("8"),
  license: id("9"),
  requestA: id("10"),
  requestB: id("11"),
  actionA: id("12"),
  actionB: id("13"),
  alertRule: id("14"),
};
const at = new Date("2026-09-07T15:00:00.000Z");
const kek = Uint8Array.from({ length: 32 }, (_, index) => index);
const deterministicBytes = (length: number) =>
  Uint8Array.from({ length }, (_, index) => (index * 11 + length) % 256);

let fixture: PostgresFixture;
let owner: pg.Client;
let privateRoot: string;
let kekFile: string;

async function credentialEnvelope(secret: string): Promise<string> {
  return serializeCredentialEnvelope(
    await encryptCredential(secret, kek, deterministicBytes),
  );
}

function payload(requestId: string, accountId: string, email: string) {
  return {
    checklistSteps: [],
    context: {
      companyId: requestId === ids.requestA ? ids.companyA : ids.companyB,
      requestId,
    },
    instruction: {
      licenseTypeName: "Claude seat",
      personEmail: email,
      requestId,
      vendorAccountId: accountId,
    },
    operation: "provision",
    protocol: "rest",
    version: 1,
  };
}

const providerSeatLimitMessage = "Your organization has reached its seat limit.";

function exactNoSeatResponse(): Response {
  return new Response(JSON.stringify({
    type: "error",
    error: {
      type: "invalid_request_error",
      message: providerSeatLimitMessage,
    },
  }), { status: 400, headers: { "content-type": "application/json" } });
}

async function seed(): Promise<void> {
  await owner.query(
    `TRUNCATE TABLE alert_notification_delivery, alert_event, audit_log,
       connector_call_observation, request_transition,
       provisioning_action, license_request, integration_credential,
       license_type, vendor_account, vendor, person, company, user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'admin@invite.test','invite-admin','group_admin','en','active',$2)`,
    [ids.admin, at],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ($1,'A','INVA','internal','active','en',$3,$4),
            ($2,'B','INVB','external','active','en',$3,$4)`,
    [ids.companyA, ids.companyB, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ($1,'a@invite.test','A',$3,'active',$5,$6),
            ($2,'b@invite.test','B',$4,'active',$5,$6)`,
    [ids.personA, ids.personB, ids.companyA, ids.companyB, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$2,$3)`,
    [ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$3,'Account A','automated',1,'active',$4,$5),
            ($2,$3,'Account B','automated',1,'active',$4,$5)`,
    [ids.accountA, ids.accountB, ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Claude seat','seat','active',$3,$4)`,
    [ids.license, ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO alert_rule
       (id,type,scope_kind,threshold,channel,enabled,created_at,created_by)
     VALUES ($1,'provisioning_failure','global','{"failures":1}'::jsonb,
             'email',true,$2,$3)`,
    [ids.alertRule, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,created_at,created_by,updated_at)
     VALUES ($1,'INV-A',$3,$5,$7,$9,'provisioning','A',$10,$11,$10),
            ($2,'INV-B',$4,$6,$8,$9,'provisioning','B',$10,$11,$10)`,
    [
      ids.requestA, ids.requestB, ids.personA, ids.personB,
      ids.companyA, ids.companyB, ids.accountA, ids.accountB,
      ids.license, at, ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO provisioning_action
       (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
     VALUES ($1,$3,$5,'invite','automated','pending',$7::jsonb,$9),
            ($2,$4,$6,'invite','automated','pending',$8::jsonb,$9)`,
    [
      ids.actionA, ids.actionB, ids.requestA, ids.requestB,
      ids.accountA, ids.accountB,
      JSON.stringify(payload(ids.requestA, ids.accountA, "a@invite.test")),
      JSON.stringify(payload(ids.requestB, ids.accountB, "b@invite.test")),
      at,
    ],
  );
  const admin = await credentialEnvelope("admin-secret-a");
  const analytics = await credentialEnvelope("analytics-secret-a");
  await owner.query(
    `INSERT INTO integration_credential
       (vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by)
     VALUES ($1,'admin_scoped',$2,'ok','active',$4,$5),
            ($1,'analytics',$3,'ok','active',$4,$5)`,
    [ids.accountA, admin, analytics, at, ids.admin],
  );
}

function jobFor(transport: (request: Request) => Promise<Response>) {
  return createAutomatedInviteDeliveryJob({
    allowedKekRoot: privateRoot,
    connectionString: fixture.appUrl,
    kekFile,
    now: () => at,
    sleep: async () => undefined,
    transport,
  });
}

async function expectNoAppConnections(): Promise<void> {
  const connections = await owner.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM pg_stat_activity
     WHERE datname=$1 AND usename='ledger_app'`,
    [fixture.databaseName],
  );
  expect(connections.rows).toEqual([{ count: 0 }]);
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  privateRoot = await mkdtemp(join(tmpdir(), "ledger-us063-"));
  kekFile = join(privateRoot, "credential-kek");
  await writeFile(kekFile, `${Buffer.from(kek).toString("base64")}\n`, "utf8");
  await chmod(kekFile, 0o400);
}, 120_000);

afterAll(async () => {
  await owner?.end();
  await fixture?.stop();
  if (privateRoot) await rm(privateRoot, { recursive: true });
});

describe("US-063 automated invite delivery", () => {
  it("kills duplicate dispatch, cross-account selection, and finalization before evidence", async () => {
    await seed();
    const requests: Request[] = [];
    const job = jobFor(async (request) => {
        requests.push(request);
        return new Response(JSON.stringify({
          type: "invite",
          id: "invite-provider-a",
          email: "a@invite.test",
          status: "pending",
        }), { status: 200, headers: { "content-type": "application/json" } });
    });
    let locksWhileOpen: readonly { count: number }[] = [];
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 1 });
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
      const locks = await owner.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM pg_locks lock
         JOIN pg_database database ON database.oid=lock.database
         WHERE lock.locktype='advisory' AND lock.granted AND database.datname=$1`,
        [fixture.databaseName],
      );
      locksWhileOpen = locks.rows;
    } finally {
      await job.close();
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("x-api-key")).toBe("admin-secret-a");
    const action = await owner.query(
      `SELECT status,vendor_ref,raw_response,sent_at,resolved_at
       FROM provisioning_action WHERE id=$1`,
      [ids.actionA],
    );
    expect(action.rows).toEqual([{
      status: "sent",
      vendor_ref: "invite-provider-a",
      raw_response: null,
      sent_at: at,
      resolved_at: null,
    }]);
    const request = await owner.query(
      `SELECT state FROM license_request WHERE id=$1`,
      [ids.requestA],
    );
    expect(request.rows).toEqual([{ state: "invited" }]);
    const observations = await owner.query(
      `SELECT provisioning_action_id,phase,classification,summary
       FROM connector_call_observation
       ORDER BY attempt,CASE phase WHEN 'requested' THEN 0 ELSE 1 END`,
    );
    expect(observations.rows).toEqual([
      {
        provisioning_action_id: ids.actionA,
        phase: "requested",
        classification: null,
        summary: { endpoint_class: "invitations", method: "POST" },
      },
      {
        provisioning_action_id: ids.actionA,
        phase: "succeeded",
        classification: "success",
        summary: {
          endpoint_class: "invitations",
          method: "POST",
          http_status: 200,
          status_class: "success",
        },
      },
    ]);
    const transition = await owner.query(
      `SELECT from_state,to_state,actor_user_id,note FROM request_transition WHERE request_id=$1`,
      [ids.requestA],
    );
    expect(transition.rows).toEqual([{
      from_state: "provisioning",
      to_state: "invited",
      actor_user_id: null,
      note: "Anthropic invitation delivered",
    }]);
    const foreign = await owner.query(
      `SELECT status,vendor_ref FROM provisioning_action WHERE id=$1`,
      [ids.actionB],
    );
    expect(foreign.rows).toEqual([{ status: "pending", vendor_ref: null }]);
    expect(locksWhileOpen).toEqual([{ count: 0 }]);
    await expectNoAppConnections();
  });

  it("rejects every payload-to-row identity mismatch before observation or transport", async () => {
    const canonical = payload(ids.requestA, ids.accountA, "a@invite.test");
    const mismatches = [
      { ...canonical, context: { ...canonical.context, companyId: ids.companyB } },
      { ...canonical, context: { ...canonical.context, requestId: ids.requestB } },
      { ...canonical, instruction: { ...canonical.instruction, requestId: ids.requestB } },
      { ...canonical, instruction: { ...canonical.instruction, vendorAccountId: ids.accountB } },
    ];
    for (const mismatch of mismatches) {
      await seed();
      await owner.query(
        "UPDATE provisioning_action SET raw_request=$2::jsonb WHERE id=$1",
        [ids.actionA, JSON.stringify(mismatch)],
      );
      let calls = 0;
      const job = jobFor(async () => {
        calls += 1;
        throw new Error("transport must not run");
      });
      try {
        await expect(job.drain({ at, vendorAccountId: ids.accountA }))
          .rejects.toThrow("AUTOMATED_INVITE_PAYLOAD_INVALID");
      } finally {
        await job.close();
      }
      expect(calls).toBe(0);
    }
  });

  it("rejects invalid drain inputs and a missing KEK path before transport", async () => {
    await seed();
    const configured = jobFor(async () => {
      throw new Error("transport must not run");
    });
    try {
      await expect(configured.drain({ at, vendorAccountId: "invalid" }))
        .rejects.toThrow("AUTOMATED_INVITE_VENDOR_INVALID");
      await expect(configured.drain({ at: new Date(Number.NaN), vendorAccountId: ids.accountA }))
        .rejects.toThrow("AUTOMATED_INVITE_TIME_INVALID");
    } finally {
      await configured.close();
    }

    const missingKek = createAutomatedInviteDeliveryJob({
      connectionString: fixture.appUrl,
      now: () => at,
      sleep: async () => undefined,
      transport: async () => {
        throw new Error("transport must not run");
      },
    });
    try {
      await expect(missingKek.drain({ at, vendorAccountId: ids.accountA }))
        .rejects.toThrow("LEDGER_CREDENTIAL_KEK_FILE is required");
    } finally {
      await missingKek.close();
    }

    const blankKek = createAutomatedInviteDeliveryJob({
      connectionString: fixture.appUrl,
      kekFile: "   ",
      now: () => at,
      sleep: async () => undefined,
      transport: async () => {
        throw new Error("transport must not run");
      },
    });
    try {
      await expect(blankKek.drain({ at, vendorAccountId: ids.accountA }))
        .rejects.toThrow("LEDGER_CREDENTIAL_KEK_FILE is required");
    } finally {
      await blankKek.close();
    }
  });

  it("rolls back a failed atomic finalization while retaining connector evidence", async () => {
    await seed();
    await owner.query(`
      CREATE OR REPLACE FUNCTION reject_invite_finalization() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced finalization failure'; END $$;
      CREATE TRIGGER reject_invite_finalization
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION reject_invite_finalization()`);
    const job = jobFor(async () => new Response(JSON.stringify({
      type: "invite",
      id: "invite-rollback-a",
      email: "a@invite.test",
      status: "pending",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA }))
        .rejects.toThrow("forced finalization failure");
    } finally {
      await job.close();
      await owner.query(`
        DROP TRIGGER IF EXISTS reject_invite_finalization ON audit_log;
        DROP FUNCTION IF EXISTS reject_invite_finalization()`);
    }
    const state = await owner.query(
      `SELECT request.state,action.status,action.vendor_ref,
              (SELECT count(*)::int FROM connector_call_observation observation
               WHERE observation.provisioning_action_id=action.id) AS observations
       FROM license_request request JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionA],
    );
    expect(state.rows).toEqual([{
      state: "provisioning",
      status: "pending",
      vendor_ref: null,
      observations: 2,
    }]);
  });

  it("refuses finalization when state changes after provider evidence", async () => {
    await seed();
    const job = jobFor(async () => {
      await owner.query("UPDATE license_request SET state='invited' WHERE id=$1", [ids.requestA]);
      return new Response(JSON.stringify({
        type: "invite",
        id: "invite-raced-a",
        email: "a@invite.test",
        status: "pending",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA }))
        .resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    const state = await owner.query(
      "SELECT status,vendor_ref FROM provisioning_action WHERE id=$1",
      [ids.actionA],
    );
    expect(state.rows).toEqual([{ status: "pending", vendor_ref: null }]);
  });

  it("kills a scheduled coordinator that fails to discover eligible vendor accounts", async () => {
    await seed();
    await owner.query(`UPDATE license_request SET state='invited' WHERE id=$1`, [ids.requestB]);
    let calls = 0;
    const job = jobFor(async () => {
      calls += 1;
      return new Response(JSON.stringify({
        type: "invite",
        id: "invite-scheduled-a",
        email: "a@invite.test",
        status: "pending",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      await expect(job.drain({ at })).resolves.toEqual({ processed: 1 });
    } finally {
      await job.close();
    }
    expect(calls).toBe(1);
  });

  it("uses the platform clock when no deterministic observation clock is supplied", async () => {
    await seed();
    await owner.query(
      "UPDATE license_request SET vendor_account_id=$2 WHERE id=$1",
      [ids.requestB, ids.accountA],
    );
    await owner.query(
      `UPDATE provisioning_action
       SET vendor_account_id=$2,raw_request=$3::jsonb
       WHERE id=$1`,
      [
        ids.actionB,
        ids.accountA,
        JSON.stringify(payload(ids.requestB, ids.accountA, "b@invite.test")),
      ],
    );
    let calls = 0;
    const job = createAutomatedInviteDeliveryJob({
      allowedKekRoot: privateRoot,
      connectionString: fixture.appUrl,
      kekFile,
      transport: async (request) => {
        calls += 1;
        const body = await request.json() as { email: string };
        return new Response(JSON.stringify({
          type: "invite",
          id: `invite-platform-clock-${calls}`,
          email: body.email,
          status: "pending",
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA }))
        .resolves.toEqual({ processed: 2 });
    } finally {
      await job.close();
    }
    expect(calls).toBe(2);
    const evidence = await owner.query<{ occurredAt: Date }>(
      `SELECT occurred_at AS "occurredAt" FROM connector_call_observation
       ORDER BY provisioning_action_id,attempt,phase`,
    );
    expect(evidence.rows).toHaveLength(4);
    for (const row of evidence.rows) {
      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(Number.isFinite(row.occurredAt.getTime())).toBe(true);
    }
  });

  it("kills replay after an ambiguous transport crash", async () => {
    await seed();
    let calls = 0;
    const job = jobFor(async () => {
      calls += 1;
      throw new Error("provider accepted before socket loss");
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    expect(calls).toBe(1);
    const observations = await owner.query(
      `SELECT phase,classification FROM connector_call_observation
       WHERE provisioning_action_id=$1`,
      [ids.actionA],
    );
    expect(observations.rows).toEqual([{ phase: "requested", classification: null }]);
    const state = await owner.query(
      `SELECT request.state,action.status,action.vendor_ref
       FROM license_request request JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionA],
    );
    expect(state.rows).toEqual([{
      state: "provisioning",
      status: "pending",
      vendor_ref: null,
    }]);
  });

  it("kills duplicate concurrent pollers with the action advisory lock", async () => {
    await seed();
    let calls = 0;
    let entered!: () => void;
    let release!: () => void;
    const transportEntered = new Promise<void>((resolve) => { entered = resolve; });
    const transportReleased = new Promise<void>((resolve) => { release = resolve; });
    const transport = async () => {
      calls += 1;
      entered();
      await transportReleased;
      return new Response(JSON.stringify({
        type: "invite",
        id: "invite-concurrent-a",
        email: "a@invite.test",
        status: "pending",
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const first = jobFor(transport);
    const second = jobFor(transport);
    try {
      const firstDrain = first.drain({ at, vendorAccountId: ids.accountA });
      await transportEntered;
      await expect(second.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
      release();
      await expect(firstDrain).resolves.toEqual({ processed: 1 });
    } finally {
      release();
      await Promise.all([first.close(), second.close()]);
    }
    expect(calls).toBe(1);
  });

  it("kills known-failure replay and preserves the failed observation", async () => {
    await seed();
    let calls = 0;
    const job = jobFor(async () => {
      calls += 1;
      return new Response(JSON.stringify({ type: "error" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 1 });
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    expect(calls).toBe(1);
    const observations = await owner.query(
      `SELECT phase,classification,summary FROM connector_call_observation
       WHERE provisioning_action_id=$1 ORDER BY phase`,
      [ids.actionA],
    );
    expect(observations.rows).toEqual([
      {
        phase: "requested",
        classification: null,
        summary: { endpoint_class: "invitations", method: "POST" },
      },
      {
        phase: "failed",
        classification: "client_error",
        summary: {
          endpoint_class: "invitations",
          method: "POST",
          http_status: 400,
          status_class: "client_error",
        },
      },
    ]);
  });

  it("atomically routes one exact durable no-seat failure and rejects concurrent or stale replays", async () => {
    // Mutations killed: accepting an unclassified provider failure, failing to bind the finalization
    // to this action/company, omitting any local state write, or allowing a duplicate transition.
    await seed();
    let calls = 0;
    let entered!: () => void;
    let release!: () => void;
    const transportEntered = new Promise<void>((resolve) => { entered = resolve; });
    const transportReleased = new Promise<void>((resolve) => { release = resolve; });
    const transport = async () => {
      calls += 1;
      entered();
      await transportReleased;
      return exactNoSeatResponse();
    };
    const first = jobFor(transport);
    const second = jobFor(transport);
    try {
      const firstDrain = first.drain({ at, vendorAccountId: ids.accountA });
      await transportEntered;
      await expect(second.drain({ at, vendorAccountId: ids.accountA }))
        .resolves.toEqual({ processed: 0 });
      release();
      await expect(firstDrain).resolves.toEqual({ processed: 1 });
      await expect(first.drain({ at, vendorAccountId: ids.accountA }))
        .resolves.toEqual({ processed: 0 });
    } finally {
      release();
      await Promise.all([first.close(), second.close()]);
    }

    expect(calls).toBe(1);
    const action = await owner.query(
      `SELECT status,vendor_ref,raw_response,sent_at,resolved_at
       FROM provisioning_action WHERE id=$1`,
      [ids.actionA],
    );
    expect(action.rows).toEqual([{
      status: "failed",
      vendor_ref: null,
      raw_response: { failure_code: "capacity_unavailable" },
      sent_at: null,
      resolved_at: at,
    }]);
    const request = await owner.query(
      `SELECT state FROM license_request WHERE id=$1`,
      [ids.requestA],
    );
    expect(request.rows).toEqual([{ state: "blocked_no_seat" }]);
    const observations = await owner.query(
      `SELECT phase,classification,summary
       FROM connector_call_observation
       WHERE provisioning_action_id=$1 ORDER BY phase`,
      [ids.actionA],
    );
    expect(observations.rows).toEqual([
      {
        phase: "requested",
        classification: null,
        summary: { endpoint_class: "invitations", method: "POST" },
      },
      {
        phase: "failed",
        classification: "client_error",
        summary: {
          endpoint_class: "invitations",
          method: "POST",
          http_status: 400,
          status_class: "client_error",
          failure_code: "capacity_unavailable",
        },
      },
    ]);
    const transitions = await owner.query(
      `SELECT from_state,to_state,actor_user_id,note
       FROM request_transition WHERE request_id=$1`,
      [ids.requestA],
    );
    expect(transitions.rows).toEqual([{
      from_state: "provisioning",
      to_state: "blocked_no_seat",
      actor_user_id: null,
      note: "Anthropic invitation capacity unavailable",
    }]);
    const audits = await owner.query(
      `SELECT action,entity_type,entity_id,company_id,note,before,after
       FROM audit_log WHERE entity_id=$1 ORDER BY occurred_at,id`,
      [ids.requestA],
    );
    expect(audits.rows).toEqual([{
      action: "request.blocked_no_seat",
      entity_type: "LicenseRequest",
      entity_id: ids.requestA,
      company_id: ids.companyA,
      note: "Anthropic invitation capacity unavailable",
      before: { state: "provisioning" },
      after: { state: "blocked_no_seat" },
    }]);
    const foreign = await owner.query(
      `SELECT request.state,action.status,action.raw_response
       FROM license_request request
       JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionB],
    );
    expect(foreign.rows).toEqual([{
      state: "provisioning",
      status: "pending",
      raw_response: null,
    }]);
    expect(JSON.stringify({ action: action.rows, audits: audits.rows })).not.toContain(
      providerSeatLimitMessage,
    );
  });

  it.each([
    [400, "Your organization has reached its seat limit. "],
    [401, providerSeatLimitMessage],
    [403, providerSeatLimitMessage],
    [409, providerSeatLimitMessage],
    [422, providerSeatLimitMessage],
    [429, providerSeatLimitMessage],
    [503, providerSeatLimitMessage],
  ])("finalizes generic provider status %i as one safe, alerted failure", async (status, message) => {
    // Mutations killed: widening no-seat routing, retaining provider-controlled data, or failing
    // to finalize and alert the exact tenant-bound action after a known terminal observation.
    await seed();
    let calls = 0;
    const secret = "Bearer should-never-persist";
    const job = jobFor(async () => {
      calls += 1;
      return new Response(JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message, request_id: secret },
      }), {
        status,
        headers: { "content-type": "application/json", "x-secret": secret },
      });
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA }))
        .resolves.toEqual({ processed: 1 });
      await expect(job.drain({ at, vendorAccountId: ids.accountA }))
        .resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    expect(calls).toBe(1);
    const state = await owner.query(
      `SELECT request.state,action.status,action.failure_reason,
              action.raw_response,action.resolved_at
       FROM license_request request
       JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionA],
    );
    expect(state.rows).toEqual([{
      state: "failed",
      status: "failed",
      failure_reason: "provider_invitation_failed",
      raw_response: { failure_code: "provider_invitation_failed" },
      resolved_at: at,
    }]);
    const transitions = await owner.query(
      `SELECT from_state,to_state,actor_user_id,note
       FROM request_transition WHERE request_id=$1`,
      [ids.requestA],
    );
    expect(transitions.rows).toEqual([{
      from_state: "provisioning",
      to_state: "failed",
      actor_user_id: null,
      note: "provider_invitation_failed",
    }]);
    const alerts = await owner.query(
      `SELECT rule.type,event.subject_ref,event.dedupe_key
       FROM alert_event event
       JOIN alert_rule rule ON rule.id=event.alert_rule_id`,
    );
    expect(alerts.rows).toEqual([{
      type: "provisioning_failure",
      subject_ref: { requestId: ids.requestA },
      dedupe_key: `automated-invite-failure:${ids.actionA}`,
    }]);
    const foreign = await owner.query(
      `SELECT request.state,action.status,action.raw_response,action.resolved_at
       FROM license_request request
       JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionB],
    );
    expect(foreign.rows).toEqual([{
      state: "provisioning",
      status: "pending",
      raw_response: null,
      resolved_at: null,
    }]);
    expect(JSON.stringify({ alerts: alerts.rows, state: state.rows })).not.toContain(secret);
    expect(JSON.stringify({ alerts: alerts.rows, state: state.rows })).not.toContain(message);
  });

  it("refuses no-seat finalization when the action changes after provider dispatch", async () => {
    await seed();
    const job = jobFor(async () => {
      await owner.query(
        "UPDATE provisioning_action SET status='failed' WHERE id=$1",
        [ids.actionA],
      );
      return new Response(JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: providerSeatLimitMessage,
        },
      }), { status: 400, headers: { "content-type": "application/json" } });
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA }))
        .resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    const state = await owner.query(
      `SELECT request.state,action.status,action.raw_response
       FROM license_request request
       JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionA],
    );
    expect(state.rows).toEqual([{
      state: "provisioning",
      status: "failed",
      raw_response: null,
    }]);
    const failure = await owner.query(
      `SELECT phase,classification,summary
       FROM connector_call_observation
       WHERE provisioning_action_id=$1 AND phase='failed'`,
      [ids.actionA],
    );
    expect(failure.rows).toEqual([{
      phase: "failed",
      classification: "client_error",
      summary: {
        endpoint_class: "invitations",
        method: "POST",
        http_status: 400,
        status_class: "client_error",
        failure_code: "capacity_unavailable",
      },
    }]);
  });

  it("rolls back when PostgreSQL suppresses the no-seat action update", async () => {
    await seed();
    await owner.query(`
      CREATE OR REPLACE FUNCTION suppress_no_seat_action_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER suppress_no_seat_action_update
      BEFORE UPDATE ON provisioning_action
      FOR EACH ROW EXECUTE FUNCTION suppress_no_seat_action_update()`);
    const job = jobFor(async () => exactNoSeatResponse());
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA }))
        .rejects.toThrow("AUTOMATED_INVITE_ACTION_CONFLICT");
    } finally {
      await job.close();
      await owner.query(`
        DROP TRIGGER IF EXISTS suppress_no_seat_action_update ON provisioning_action;
        DROP FUNCTION IF EXISTS suppress_no_seat_action_update()`);
    }
    const state = await owner.query(
      `SELECT request.state,action.status,action.raw_response
       FROM license_request request
       JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionA],
    );
    expect(state.rows).toEqual([{
      state: "provisioning",
      status: "pending",
      raw_response: null,
    }]);
    const transitions = await owner.query(
      "SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1",
      [ids.requestA],
    );
    expect(transitions.rows).toEqual([{ count: 0 }]);
  });

  it("rolls back no-seat finalization without deleting its durable sanitized observation", async () => {
    // Mutations killed: committing a partial local finalization after audit failure.
    await seed();
    await owner.query(`
      CREATE OR REPLACE FUNCTION reject_no_seat_finalization() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced no-seat finalization failure'; END $$;
      CREATE TRIGGER reject_no_seat_finalization
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION reject_no_seat_finalization()`);
    const job = jobFor(async () => exactNoSeatResponse());
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA }))
        .rejects.toThrow("forced no-seat finalization failure");
    } finally {
      await job.close();
      await owner.query(`
        DROP TRIGGER IF EXISTS reject_no_seat_finalization ON audit_log;
        DROP FUNCTION IF EXISTS reject_no_seat_finalization()`);
    }
    const state = await owner.query(
      `SELECT request.state,action.status,action.raw_response,action.resolved_at
       FROM license_request request
       JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionA],
    );
    expect(state.rows).toEqual([{
      state: "provisioning",
      status: "pending",
      raw_response: null,
      resolved_at: null,
    }]);
    const transitions = await owner.query(
      `SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1`,
      [ids.requestA],
    );
    expect(transitions.rows).toEqual([{ count: 0 }]);
    const foreign = await owner.query(
      `SELECT request.state,action.status,action.raw_response,action.resolved_at
       FROM license_request request
       JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionB],
    );
    expect(foreign.rows).toEqual([{
      state: "provisioning",
      status: "pending",
      raw_response: null,
      resolved_at: null,
    }]);
    const failedObservations = await owner.query(
      `SELECT phase,classification,summary
       FROM connector_call_observation
       WHERE provisioning_action_id=$1 AND phase='failed'`,
      [ids.actionA],
    );
    expect(failedObservations.rows).toEqual([{
      phase: "failed",
      classification: "client_error",
      summary: {
        endpoint_class: "invitations",
        method: "POST",
        http_status: 400,
        status_class: "client_error",
        failure_code: "capacity_unavailable",
      },
    }]);
  });

  it("kills finalization when the provider response names another recipient", async () => {
    await seed();
    const job = jobFor(async () => new Response(JSON.stringify({
      type: "invite",
      id: "invite-wrong-recipient",
      email: "other@invite.test",
      status: "pending",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    const state = await owner.query(
      `SELECT request.state,action.status,action.vendor_ref
       FROM license_request request JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [ids.actionA],
    );
    expect(state.rows).toEqual([{
      state: "provisioning",
      status: "pending",
      vendor_ref: null,
    }]);
  });

  it("kills dispatch through an inactive automated account", async () => {
    await seed();
    await owner.query(`UPDATE vendor_account SET status='inactive' WHERE id=$1`, [ids.accountA]);
    let calls = 0;
    const job = jobFor(async () => {
      calls += 1;
      throw new Error("transport must not run");
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    expect(calls).toBe(0);
  });

  it("kills malformed payload and stale-state dispatch before transport", async () => {
    await seed();
    await owner.query(
      `UPDATE provisioning_action SET raw_request='{"operation":"provision"}'::jsonb WHERE id=$1`,
      [ids.actionA],
    );
    let calls = 0;
    const job = jobFor(async () => {
      calls += 1;
      throw new Error("transport must not run");
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow(
        "AUTOMATED_INVITE_PAYLOAD_INVALID",
      );
      await owner.query(`UPDATE license_request SET state='invited' WHERE id=$1`, [ids.requestA]);
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    expect(calls).toBe(0);
    const observations = await owner.query(
      `SELECT count(*)::int AS count FROM connector_call_observation`,
    );
    expect(observations.rows).toEqual([{ count: 0 }]);
  });

  it("kills missing account-bound credentials before observation and transport", async () => {
    await seed();
    await owner.query(`DELETE FROM integration_credential WHERE vendor_account_id=$1`, [ids.accountA]);
    let calls = 0;
    const job = jobFor(async () => {
      calls += 1;
      throw new Error("transport must not run");
    });
    try {
      await expect(job.drain({ at, vendorAccountId: ids.accountA })).rejects.toThrow(
        /missing_credential/,
      );
    } finally {
      await job.close();
    }
    expect(calls).toBe(0);
    const observations = await owner.query(
      `SELECT count(*)::int AS count FROM connector_call_observation`,
    );
    expect(observations.rows).toEqual([{ count: 0 }]);
  });
});
