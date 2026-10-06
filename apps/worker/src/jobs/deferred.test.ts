import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { encryptCredential } from "@smp/db/credential-crypto";
import { serializeCredentialEnvelope } from "@smp/domain";
import { describe, expect, it } from "vitest";

import { createDeferredJobHandlers } from "./deferred.js";

describe("US-046 deferred job handlers", () => {
  it("reports each unavailable later-sprint dependency as skipped work", async () => {
    const handlers = createDeferredJobHandlers();
    const context = {
      at: new Date("2026-08-05T10:30:00.000Z"),
      idempotencyKey: "test-key",
      jobId: "test-job",
    };

    await expect(handlers.analyticsSync({ ...context, jobName: "analyticsSync" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-070",
    });
    await expect(handlers.memberSync({ ...context, jobName: "memberSync" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-018",
    });
    await expect(handlers.invitePoll({ ...context, jobName: "invitePoll" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-063",
    });
    await expect(handlers.alertEvaluation({ ...context, jobName: "alertEvaluation" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-042",
    });
    await expect(handlers.capacityRecovery({ ...context, jobName: "capacityRecovery" })).resolves.toEqual({
      processed: 0,
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-023",
    });
    await expect(handlers.closePrecheck({ ...context, jobName: "closePrecheck" })).resolves.toMatchObject({
      reason: "dependency_not_delivered",
      status: "skipped",
      story: "US-034",
    });
  });

  it("invokes the third-business-day policy before deferring the unavailable close handler", async () => {
    const handlers = createDeferredJobHandlers({ holidays: new Set(["2026-08-03"]) });

    await expect(
      handlers.closePrecheck({
        at: new Date("2026-08-05T10:30:00.000Z"),
        idempotencyKey: "close-precheck:2026-08",
        jobId: "job-not-third-business-day",
        jobName: "closePrecheck",
      }),
    ).resolves.toEqual({ processed: 0, status: "succeeded" });
    await expect(
      handlers.closePrecheck({
        at: new Date("2026-08-06T10:30:00.000Z"),
        idempotencyKey: "close-precheck:2026-08",
        jobId: "job-third-business-day",
        jobName: "closePrecheck",
      }),
    ).resolves.toMatchObject({ reason: "dependency_not_delivered", status: "skipped", story: "US-034" });
  });

  it("runs capacity recovery and closes its real PostgreSQL pool", async () => {
    let fixture: PostgresFixture | undefined;
    let privateRoot: string | undefined;
    try {
      fixture = await createPostgresFixture();
      await fixture.migrate();
      privateRoot = await mkdtemp(join(tmpdir(), "ledger-deferred-"));
      const credentialKekFile = join(privateRoot, "credential-kek");
      await writeFile(credentialKekFile, `${Buffer.alloc(32).toString("base64")}\n`, "utf8");
      await chmod(credentialKekFile, 0o400);
      const handlers = createDeferredJobHandlers(
        { holidays: new Set() },
        {
          connectionString: fixture.appUrl,
          credentialKekAllowedRoot: privateRoot,
          credentialKekFile,
          now: () => new Date("2026-08-05T10:30:00.000Z"),
          sleep: async () => undefined,
          transport: async () => new Response("{}", { status: 500 }),
          workerId: "deferred-capacity-recovery-test",
        },
      );

      await expect(handlers.capacityRecovery({
        at: new Date("2026-08-05T10:30:00.000Z"),
        idempotencyKey: "capacity-recovery:2026-08-05T10:30",
        jobId: "capacity-recovery-test-job",
        jobName: "capacityRecovery",
      })).resolves.toEqual({ processed: 0, status: "succeeded" });
      await expect(handlers.invitePoll({
        at: new Date("2026-08-05T10:30:00.000Z"),
        idempotencyKey: "invite-poll:scheduled:2026-08-05T10:30",
        jobId: "invite-poll-test-job",
        jobName: "invitePoll",
      })).resolves.toEqual({ processed: 0, status: "succeeded" });

      const owner = await fixture.connectAsOwner();
      try {
        await expect(owner.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=$1 AND usename='ledger_app'`,
          [fixture.databaseName],
        )).resolves.toMatchObject({ rows: [{ count: 0 }] });
      } finally {
        await owner.end();
      }
    } finally {
      await fixture?.stop();
      if (privateRoot) await rm(privateRoot, { recursive: true });
    }
  }, 120_000);

  it("closes all invite-poll resources when the membership activation dependency fails", async () => {
    let fixture: PostgresFixture | undefined;
    try {
      fixture = await createPostgresFixture();
      await fixture.migrate();
      const handlers = createDeferredJobHandlers(
        { holidays: new Set() },
        {
          connectionString: fixture.appUrl,
          now: () => new Date("2026-09-09T04:30:00.000Z"),
          sleep: async () => undefined,
          transport: async () => new Response("{}", { status: 500 }),
          workerId: "deferred-invite-poll-cleanup-test",
        },
      );

      await expect(handlers.invitePoll({
        at: new Date("2026-09-09T04:30:00.000Z"),
        idempotencyKey: "invite-poll:scheduled:2026-09-09T04:30",
        jobId: "invite-poll-cleanup-test-job",
        jobName: "invitePoll",
        vendorAccountId: "00000000-0000-0000-0000-000000000066",
      })).rejects.toThrow("LEDGER_CREDENTIAL_KEK_FILE is required");

      const owner = await fixture.connectAsOwner();
      try {
        await expect(owner.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=$1 AND usename='ledger_app'`,
          [fixture.databaseName],
        )).resolves.toMatchObject({ rows: [{ count: 0 }] });
      } finally {
        await owner.end();
      }
    } finally {
      await fixture?.stop();
    }
  }, 120_000);

  it("delivers before it activates the exact vendor account in one quarter-hour poll", async () => {
    const at = new Date("2026-09-09T04:30:00.000Z");
    const id = (suffix: string) => `26600000-0000-4000-8000-${suffix.padStart(12, "0")}`;
    const ids = {
      account: id("7"),
      action: id("12"),
      expiryPerson: id("20"),
      expiryRequest: id("21"),
      expiryAction: id("22"),
      expiryRule: id("23"),
      admin: id("1"),
      company: id("2"),
      license: id("9"),
      person: id("4"),
      request: id("10"),
      vendor: id("6"),
    };
    const kek = Uint8Array.from({ length: 32 }, (_, index) => index);
    let fixture: PostgresFixture | undefined;
    let privateRoot: string | undefined;
    try {
      fixture = await createPostgresFixture();
      await fixture.migrate();
      privateRoot = await mkdtemp(join(tmpdir(), "ledger-deferred-order-"));
      const credentialKekFile = join(privateRoot, "credential-kek");
      await writeFile(credentialKekFile, `${Buffer.from(kek).toString("base64")}\n`, "utf8");
      await chmod(credentialKekFile, 0o400);
      const adminCredential = serializeCredentialEnvelope(await encryptCredential("admin-secret", kek));
      const analyticsCredential = serializeCredentialEnvelope(await encryptCredential("analytics-secret", kek));
      const owner = await fixture.connectAsOwner();
      try {
        await owner.query(`INSERT INTO user_account (id,email,idp_subject,global_role,ui_language,status,created_at)
          VALUES ($1,'admin@deferred.test','deferred-admin','group_admin','en','active',$2)`, [ids.admin, at]);
        await owner.query(`INSERT INTO company (id,name,code,type,status,statement_language,created_at,created_by)
          VALUES ($1,'Deferred','DEFR','internal','active','en',$2,$3)`, [ids.company, at, ids.admin]);
        await owner.query(`INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by)
          VALUES ($1,'accepted@deferred.test','Accepted',$2,'active',$3,$4)`, [ids.person, ids.company, at, ids.admin]);
        await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
          has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
          VALUES ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$2,$3)`, [ids.vendor, at, ids.admin]);
        await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
          VALUES ($1,$2,'Deferred account','automated',1,'active',$3,$4)`, [ids.account, ids.vendor, at, ids.admin]);
        await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
          VALUES ($1,$2,'Seat','seat','active',$3,$4)`, [ids.license, ids.vendor, at, ids.admin]);
        await owner.query(`INSERT INTO license_request (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
          state,justification,created_at,created_by,updated_at)
          VALUES ($1,'DEFR-1',$2,$3,$4,$5,'provisioning','Quarter-hour activation',$6,$7,$6)`,
        [ids.request, ids.person, ids.company, ids.account, ids.license, at, ids.admin]);
        await owner.query(`INSERT INTO provisioning_action (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
          VALUES ($1,$2,$3,'invite','automated','pending',$4::jsonb,$5)`, [
          ids.action, ids.request, ids.account,
          JSON.stringify({
            checklistSteps: [],
            context: { companyId: ids.company, requestId: ids.request },
            instruction: {
              licenseTypeName: "Seat",
              personEmail: "accepted@deferred.test",
              requestId: ids.request,
              vendorAccountId: ids.account,
            },
            operation: "provision",
            protocol: "rest",
            version: 1,
          }),
          at,
        ]);
        await owner.query(`INSERT INTO integration_credential (vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by)
          VALUES ($1,'admin_scoped',$2,'ok','active',$4,$5),($1,'analytics',$3,'ok','active',$4,$5)`,
        [ids.account, adminCredential, analyticsCredential, at, ids.admin]);
        const expiredAt = new Date(at.getTime()-72*3600000);
        await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by)
          VALUES($1,'expired@deferred.test','Expired',$2,'active',$3,$4)`,[ids.expiryPerson,ids.company,expiredAt,ids.admin]);
        await owner.query(`INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,requested_by,created_at,created_by)
          VALUES($1,'DEFR-EXPIRY',$2,$3,$4,$5,'invited','Expired access',$6,$7,$6)`,[ids.expiryRequest,ids.expiryPerson,ids.company,ids.account,ids.license,ids.admin,expiredAt]);
        await owner.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,sent_at,created_at)
          VALUES($1,$2,$3,'invite','automated','sent','expired-invite',$4,$4)`,[ids.expiryAction,ids.expiryRequest,ids.account,expiredAt]);
        await owner.query(`UPDATE alert_rule SET enabled=false`);
        await owner.query(`INSERT INTO alert_rule(id,type,scope_kind,company_id,threshold,channel,enabled,created_at,created_by)
          VALUES($1,'invite_unaccepted','company',$2,'{"hours":24,"auto_withdraw_after_hours":48}','email',true,$3,$4)`,[ids.expiryRule,ids.company,at,ids.admin]);
      } finally {
        await owner.end();
      }

      const calls: string[] = [];
      const handlers = createDeferredJobHandlers(
        { holidays: new Set() },
        {
          connectionString: fixture.appUrl,
          credentialKekAllowedRoot: privateRoot,
          credentialKekFile,
          now: () => at,
          sleep: async () => undefined,
          transport: async (request) => {
            const url = new URL(request.url);
            if (request.method === "POST" && url.pathname.endsWith("/invites")) {
              calls.push("invite");
              return new Response(JSON.stringify({
                type: "invite", id: "provider-invite", email: "accepted@deferred.test", status: "pending",
              }), { status: 200, headers: { "content-type": "application/json" } });
            }
            if (request.method === "GET" && url.pathname.endsWith("/users")) {
              calls.push("members");
              return new Response(JSON.stringify({
                data: [{ type: "user", id: "provider-user", name: "Accepted", email: "accepted@deferred.test" }],
                has_more: false, first_id: "provider-user", last_id: "provider-user",
              }), { status: 200, headers: { "content-type": "application/json" } });
            }
            if(request.method==='GET' && url.pathname.endsWith('/invites')) {
              calls.push('invitations');
              return new Response(JSON.stringify({data:[{id:'expired-invite',type:'invite',email:'expired@deferred.test',status:'pending'}],has_more:false,first_id:'expired-invite',last_id:'expired-invite'}),{headers:{'content-type':'application/json'}});
            }
            if(request.method==='DELETE' && url.pathname.endsWith('/invites/expired-invite')) {
              calls.push('withdrawal');
              return new Response(JSON.stringify({id:'expired-invite',type:'invite_deleted'}),{headers:{'content-type':'application/json'}});
            }
            throw new Error(`unexpected provider request: ${request.method} ${url.pathname}`);
          },
          workerId: "deferred-invite-poll-order-test",
        },
      );

      await expect(handlers.invitePoll({
        at,
        idempotencyKey: "invite-poll:26600000-0000-4000-8000-000000000007:2026-09-09T04:30",
        jobId: "invite-poll-order-test-job",
        jobName: "invitePoll",
        vendorAccountId: ids.account,
      })).resolves.toEqual({ processed: 3, status: "succeeded" });
      expect(calls).toEqual(["invite", "members", "invitations", "members", "invitations", "withdrawal"]);

      const verify = await fixture.connectAsOwner();
      try {
        expect((await verify.query(`SELECT state FROM license_request WHERE id=$1 AND company_id=$2`,[ids.expiryRequest,ids.company])).rows).toEqual([{state:'deprovisioned'}]);
        expect((await verify.query(`SELECT count(*)::int AS count FROM lifecycle_notification WHERE company_id=$1 AND request_id=$2`,[ids.company,ids.expiryRequest])).rows[0].count).toBe(1);
        await expect(verify.query(
          `SELECT request.state,action.status,action.sent_at,transition.occurred_at
             FROM license_request request
             JOIN provisioning_action action ON action.request_id=request.id
             JOIN request_transition transition ON transition.request_id=request.id AND transition.to_state='active'
             WHERE request.id=$1`,
          [ids.request],
        )).resolves.toMatchObject({ rows: [{ state: "active", status: "confirmed", sent_at: at, occurred_at: at }] });
      } finally {
        await verify.end();
      }
    } finally {
      await fixture?.stop();
      if (privateRoot) await rm(privateRoot, { recursive: true });
    }
  }, 120_000);
});
