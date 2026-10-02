import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test } from "vitest";
import { createPostgresFixture } from "./testing/postgres-container";
import { pendingInvitationRows, type PendingInvitationRow } from "./pending-invitations";

test("current delivered invitation facts exclude other companies and superseded or resolved actions", async () => {
  const fixture = await createPostgresFixture();
  await fixture.migrate();
  const owner = await fixture.connectAsOwner();
  const companyA = randomUUID(), companyB = randomUUID(), vendor = randomUUID(), account = randomUUID(), license = randomUUID();
  const at = new Date("2026-10-02T15:07:00Z");
  const sent = new Date("2026-09-25T15:07:00Z");
  const ids: Record<string,string> = {};
  try {
    await owner.query(`INSERT INTO company (id,name,code,type,status,created_at,created_by)
      VALUES ($1,'Facts A','FACT067A','internal','active',$3,'00000000-0000-0000-0000-000000000001'),
        ($2,'Facts B','FACT067B','internal','active',$3,'00000000-0000-0000-0000-000000000001')`,[companyA,companyB,at]);
    await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
      VALUES ($1,'Facts vendor','api','rest',true,true,false,false,'email','active',$2,'00000000-0000-0000-0000-000000000001')`,[vendor,at]);
    await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
      VALUES ($1,$2,'Facts account','automated',1,'active',$3,'00000000-0000-0000-0000-000000000001')`,[account,vendor,at]);
    await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
      VALUES ($1,$2,'Facts seat','seat','active',$3,'00000000-0000-0000-0000-000000000001')`,[license,vendor,at]);
    for (const [name,company,status] of [['current',companyA,'sent'],['foreign',companyB,'sent'],['accepted',companyA,'confirmed'],['superseded',companyA,'sent']] as const) {
      const person = randomUUID(), request = randomUUID(); ids[name] = request;
      await owner.query(`INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by)
        VALUES ($1,$2,$3,$4,'active',$5,'00000000-0000-0000-0000-000000000001')`,[person,`${name}@facts.test`,name,company,sent]);
      await owner.query(`INSERT INTO license_request (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,'invited','Facts evidence',$7,'00000000-0000-0000-0000-000000000001')`,[request,`REQ-FACTS-${name}`,person,company,account,license,sent]);
      await owner.query(`INSERT INTO provisioning_action (request_id,vendor_account_id,kind,mode,status,vendor_ref,sent_at,resolved_at,created_at)
        VALUES ($1,$2,'invite','automated',$3,$4,$5,$6,$5)`,[request,account,status,`facts-${name}`,sent,status==='confirmed'?at:null]);
      if (name==='superseded') await owner.query(`INSERT INTO provisioning_action (request_id,vendor_account_id,kind,mode,status,created_at)
        VALUES ($1,$2,'invite','automated','pending',$3)`,[request,account,at]);
    }
    const database = drizzle(owner);
    const facts = await database.execute<PendingInvitationRow>(pendingInvitationRows(at,sql`request.company_id=${companyA}::uuid`));
    expect(facts.rows.map(row=>[row.requestId,row.requestNo,row.ageHours])).toEqual([[ids.current,'REQ-FACTS-current',168]]);
    const foreign = await database.execute<PendingInvitationRow>(pendingInvitationRows(at,sql`request.company_id=${companyB}::uuid`));
    expect(foreign.rows.map(row=>row.requestId)).toEqual([ids.foreign]);
    const none = await database.execute<PendingInvitationRow>(pendingInvitationRows(at,sql`FALSE`));
    expect(none.rows).toEqual([]);
  } finally { await owner.end(); await fixture.stop(); }
},30000);
