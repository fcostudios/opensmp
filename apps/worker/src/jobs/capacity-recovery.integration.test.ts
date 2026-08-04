import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import {
  blockedDecisionAging,
  createCapacityRecoveryJob,
} from "./capacity-recovery.js";

const id = (suffix: string) =>
  `23100000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"),
  companyA: id("2"),
  companyB: id("3"),
  vendor: id("4"),
  account: id("5"),
  license: id("6"),
  personA: id("7"),
  personB: id("8"),
  requestA: id("9"),
  requestB: id("10"),
  capacity: id("11"),
};
const at = new Date("2026-08-04T15:00:00.000Z");
let fixture: PostgresFixture;
let owner: pg.Client;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  await owner.query(
    `TRUNCATE TABLE audit_log, request_transition, provisioning_action,
       license_request, vendor_account_capacity, license_assignment, license_type,
       vendor_account, vendor, person, company, user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'admin@recovery.test','recovery-admin','group_admin','es','active',$2)`,
    [ids.admin, at],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ($1,'A','RECA','internal','active','es',$3,$4),
            ($2,'B','RECB','external','active','es',$3,$4)`,
    [ids.companyA, ids.companyB, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ($1,'a@recovery.test','A',$3,'active',$5,$6),
            ($2,'b@recovery.test','B',$4,'active',$5,$6)`,
    [ids.personA, ids.personB, ids.companyA, ids.companyB, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Vendor','api','rest',true,true,false,false,'email','active',$2,$3)`,
    [ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Account','automated',1,'active',$3,$4)`,
    [ids.account, ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Seat','seat','active',$3,$4)`,
    [ids.license, ids.vendor, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account_capacity
       (id,vendor_account_id,license_type_id,purchased_qty,effective_from,
        created_at,created_by)
     VALUES ($1,$2,$3,2,'2026-08-04',$4,$5)`,
    [ids.capacity, ids.account, ids.license, at, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,created_at,created_by)
     VALUES ($1,'REC-A',$3,$5,$7,$8,'blocked_no_seat','A',$9,$10),
            ($2,'REC-B',$4,$6,$7,$8,'blocked_no_seat','B',$9,$10)`,
    [
      ids.requestA,
      ids.requestB,
      ids.personA,
      ids.personB,
      ids.companyA,
      ids.companyB,
      ids.account,
      ids.license,
      new Date("2026-08-03T15:00:00.000Z"),
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO request_transition
       (request_id,from_state,to_state,actor_user_id,note,occurred_at)
     VALUES ($1,'approved','blocked_no_seat',$3,'empty',$4),
            ($2,'approved','blocked_no_seat',$3,'empty',$4)`,
    [ids.requestA, ids.requestB, ids.admin, new Date("2026-08-03T15:00:00.000Z")],
  );
}, 120_000);

afterAll(async () => {
  await owner?.end();
  await fixture?.stop();
});

describe("US-023 capacity recovery with real PostgreSQL", () => {
  it("kills cross-tenant recovery and duplicate resume transitions", async () => {
    const job = createCapacityRecoveryJob({ connectionString: fixture.appUrl, now: () => at });
    try {
      const payload = {
        capacityId: ids.capacity,
        companyIds: [ids.companyA],
        effectiveFrom: "2026-08-04",
        licenseTypeId: ids.license,
        publishedAt: at.toISOString(),
        vendorAccountId: ids.account,
      } as const;
      await expect(job.run(payload)).resolves.toEqual({ resumedRequestIds: [ids.requestA] });
      await expect(job.run(payload)).resolves.toEqual({ resumedRequestIds: [] });
    } finally {
      await job.close();
    }

    const state = await owner.query(
      `SELECT id,state FROM license_request ORDER BY id`,
    );
    expect(state.rows).toEqual([
      { id: ids.requestA, state: "provisioning" },
      { id: ids.requestB, state: "blocked_no_seat" },
    ]);
    const transitions = await owner.query(
      `SELECT request_id,to_state,count(*)::int AS count
       FROM request_transition WHERE to_state = 'provisioning'
       GROUP BY request_id,to_state`,
    );
    expect(transitions.rows).toEqual([
      { count: 1, request_id: ids.requestA, to_state: "provisioning" },
    ]);
  });

  it("kills calendar-day aging by escalating only after one Ecuador business day", () => {
    const calendar = { holidays: new Set(["2026-08-10"]) };
    expect(
      blockedDecisionAging(
        new Date("2026-08-07T15:00:00.000Z"),
        new Date("2026-08-12T15:00:00.000Z"),
        calendar,
      ),
    ).toEqual({ businessDays: 2, escalated: true });
    expect(
      blockedDecisionAging(
        new Date("2026-08-07T15:00:00.000Z"),
        new Date("2026-08-10T15:00:00.000Z"),
        calendar,
      ),
    ).toEqual({ businessDays: 0, escalated: false });
  });
});
