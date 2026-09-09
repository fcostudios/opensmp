import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPostgresFixture, type PostgresFixture } from "./testing/postgres-container.js";
import { enqueueLifecycleDecision, enqueueLifecycleProvisioningComplete } from "./lifecycle-notifications.js";

const id = (n: number) => `36600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2026-09-09T12:00:00.000Z");
let fixture: PostgresFixture;
let owner: pg.Client;
let app: pg.Client;
beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  app = await fixture.connectAsApp();
  await owner.query(`INSERT INTO user_account (id,email,idp_subject,global_role,ui_language,status,created_at)
    VALUES ($1,'requester@outbox.test','outbox-requester',NULL,'es','active',$2)`, [id(1), at]);
  await owner.query(`INSERT INTO company (id,name,code,type,status,statement_language,created_at,created_by)
    VALUES ($1,'One','ONE','internal','active','es',$3,$4),($2,'Two','TWO','internal','active','en',$3,$4)`, [id(2), id(3), at, id(1)]);
  await owner.query(`INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by)
    VALUES ($1,'person@outbox.test','Person',$2,'active',$3,$4)`, [id(4), id(2), at, id(1)]);
  await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
    VALUES ($1,'Vendor','orchestration','none',false,false,false,false,'email','active',$2,$3)`, [id(5), at, id(1)]);
  await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
    VALUES ($1,$2,'Account','orchestration',1,'active',$3,$4)`, [id(6), id(5), at, id(1)]);
  await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
    VALUES ($1,$2,'Seat','seat','active',$3,$4)`, [id(7), id(5), at, id(1)]);
  await owner.query(`INSERT INTO license_request (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,requested_by,created_at,created_by,updated_at)
    VALUES ($1,'OUTBOX-1',$2,$3,$4,$5,'active','Access',$6,$7,$6,$7)`, [id(8), id(4), id(2), id(6), id(7), id(1), at]);
}, 120_000);
afterAll(async () => { await app?.end(); await owner?.end(); await fixture?.stop(); });

it("shares exact requester notification semantics across active and decision transitions, deduping retries", async () => {
  const database = drizzle(app);
  for (const [state, kind] of [["active", "provisioning_complete"], ["approved", "decision"], ["rejected", "decision"]] as const) {
    await owner.query("UPDATE license_request SET state=$1 WHERE id=$2", [state, id(8)]);
    await database.transaction(async (transaction) => {
      for (let replay = 0; replay < 2; replay += 1) {
        if (state === "active") await enqueueLifecycleProvisioningComplete(transaction, id(8), at);
        else await enqueueLifecycleDecision(transaction, id(8), state, at);
      }
    });
    expect((await owner.query("SELECT company_id,kind,recipient_user_account_id,recipient_email,recipient_locale,request_state,created_at FROM lifecycle_notification WHERE request_state=$1", [state])).rows)
      .toEqual([{ company_id: id(2), kind, recipient_user_account_id: id(1), recipient_email: "requester@outbox.test", recipient_locale: "es", request_state: state, created_at: at }]);
  }
});

it("never queues the wrong state, inactive requester, or mismatched tenant", async () => {
  const database = drizzle(app);
  for (const variant of ["state", "inactive", "tenant"] as const) {
    await owner.query("TRUNCATE lifecycle_notification CASCADE");
    await owner.query("UPDATE user_account SET status=$1 WHERE id=$2", [variant === "inactive" ? "disabled" : "active", id(1)]);
    await owner.query("UPDATE license_request SET state=$1,company_id=$2 WHERE id=$3", [variant === "state" ? "invited" : "active", variant === "tenant" ? id(3) : id(2), id(8)]);
    await database.transaction((transaction) => enqueueLifecycleProvisioningComplete(transaction, id(8), at));
    expect((await owner.query("SELECT count(*)::int AS notifications FROM lifecycle_notification")).rows).toEqual([{ notifications: 0 }]);
  }
});
