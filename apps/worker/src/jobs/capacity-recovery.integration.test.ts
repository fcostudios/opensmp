import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import { createOrchestrationService } from "../../../web/src/modules/request-workflow/orchestration.js";
import { createCapacityRecoveryJob } from "./capacity-recovery.js";

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
  requestFreed: id("12"),
  requestBoundary: id("13"),
  accountRace: id("14"),
  licenseRace: id("15"),
  capacityRace: id("16"),
  requestRace: id("17"),
  accountConfirm: id("18"),
  licenseConfirm: id("19"),
  capacityConfirm: id("20"),
  requestConfirm: id("21"),
  requestWaiting: id("22"),
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
       license_request, capacity_recovery_work, vendor_account_capacity, license_assignment, license_type,
       vendor_account, vendor, person, company, user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'admin@recovery.test','recovery-admin','group_admin','es','active',$2),
            ('00000000-0000-0000-0000-000000000001','system@ledger.invalid',
             'ledger-system',NULL,'en','active',$2)`,
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
    await owner.query(
      `SELECT enqueue_capacity_recovery($1,$2,$3,'2026-08-04','capacity_change',$4)`,
      [ids.capacity, ids.account, ids.license, at],
    );
    const job = createCapacityRecoveryJob({ connectionString: fixture.appUrl, now: () => at });
    try {
      await expect(job.drain()).resolves.toEqual({ processed: 1 });
      await expect(job.drain()).resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }

    const state = await owner.query(
      `SELECT id,state FROM license_request ORDER BY id`,
    );
    expect(state.rows).toEqual([
      { id: ids.requestA, state: "provisioning" },
      { id: ids.requestB, state: "provisioning" },
    ]);
    const transitions = await owner.query(
      `SELECT request_id,to_state,count(*)::int AS count
       FROM request_transition WHERE to_state = 'provisioning'
       GROUP BY request_id,to_state`,
    );
    expect(transitions.rows).toEqual([
      { count: 1, request_id: ids.requestA, to_state: "provisioning" },
      { count: 1, request_id: ids.requestB, to_state: "provisioning" },
    ]);

    const orchestration = createOrchestrationService(fixture.appUrl, {
      now: () => at,
    });
    try {
      const action = await orchestration.routeApprovedRequest({
        companyGrants: [],
        companyIds: [],
        employeeCompanyId: null,
        globalRole: "group_admin",
        idpSubject: "recovery-admin",
        roles: ["group_admin"],
        userAccountId: ids.admin,
        userId: ids.admin,
      }, ids.requestA);
      expect(action).toMatchObject({
        kind: "checklist",
        mode: "orchestration",
        status: "pending",
      });
      expect(action).toHaveProperty("rawRequest.operation", "provision");
      await expect(
        orchestration.pendingChecklist({
          companyGrants: [],
          companyIds: [],
          employeeCompanyId: null,
          globalRole: "group_admin",
          idpSubject: "recovery-admin",
          roles: ["group_admin"],
          userAccountId: ids.admin,
          userId: ids.admin,
        }, ids.requestA),
      ).resolves.toMatchObject({ id: action.id });
      await expect(orchestration.confirmChecklistDone({
        companyGrants: [],
        companyIds: [],
        employeeCompanyId: null,
        globalRole: "group_admin",
        idpSubject: "recovery-admin",
        roles: ["group_admin"],
        userAccountId: ids.admin,
        userId: ids.admin,
      }, {
        actionId: action.id,
        confirmationId: "recovered-action-confirmation",
      })).resolves.toMatchObject({ status: "active" });
      await expect(owner.query(
        "SELECT state FROM license_request WHERE id=$1",
        [ids.requestA],
      )).resolves.toMatchObject({ rows: [{ state: "active" }] });
    } finally {
      await orchestration.close();
    }
  });

  it("kills early future-effective execution and reclaims an expired lease", async () => {
    await owner.query(
      `INSERT INTO capacity_recovery_work
         (idempotency_key,capacity_id,vendor_account_id,license_type_id,effective_from,
          available_at,source,status,lease_token,lease_expires_at)
       VALUES ('future-work',$1,$2,$3,'2026-08-09','2026-08-09T05:00:00Z',
               'capacity_change','pending',NULL,NULL),
              ('expired-work',$1,$2,$3,'2026-08-04',$4,
               'capacity_change','processing',$5,'2026-08-04T14:59:00Z')`,
      [ids.capacity, ids.account, ids.license, at, id("99")],
    );
    const job = createCapacityRecoveryJob({ connectionString: fixture.appUrl, now: () => at });
    try {
      await expect(job.drain()).resolves.toEqual({ processed: 1 });
    } finally {
      await job.close();
    }
    const states = await owner.query(
      `SELECT idempotency_key,status,attempt_count FROM capacity_recovery_work
       WHERE idempotency_key IN ('future-work','expired-work') ORDER BY idempotency_key`,
    );
    expect(states.rows).toEqual([
      { attempt_count: 1, idempotency_key: "expired-work", status: "completed" },
      { attempt_count: 0, idempotency_key: "future-work", status: "pending" },
    ]);
  });

  it("uses the selected capacity effective date when a later seat-freed event resumes work", async () => {
    const freedAt = new Date("2026-08-05T15:00:00.000Z");
    await owner.query(
      `UPDATE provisioning_action SET status='confirmed',resolved_at=$1
       WHERE request_id=$2`,
      [freedAt, ids.requestA],
    );
    await owner.query(
      `UPDATE provisioning_action SET status='failed',resolved_at=$1,
         failure_reason='released for recovery test' WHERE request_id=$2`,
      [freedAt, ids.requestB],
    );
    await owner.query(
      `INSERT INTO license_request
         (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
          state,justification,created_at,created_by)
       VALUES ($1,'REC-FREED',$2,$3,$4,$5,'blocked_no_seat','freed',$6,$7)`,
      [ids.requestFreed, ids.personA, ids.companyA, ids.account, ids.license, freedAt, ids.admin],
    );
    await owner.query(
      `INSERT INTO request_transition
         (request_id,from_state,to_state,actor_user_id,note,occurred_at)
       VALUES ($1,'approved','blocked_no_seat',$2,'empty',$3)`,
      [ids.requestFreed, ids.admin, freedAt],
    );
    await owner.query(
      `SELECT enqueue_capacity_recovery(NULL,$1,$2,'2026-08-05','seat_freed',$3,$4)`,
      [ids.account, ids.license, freedAt, id("120")],
    );
    const job = createCapacityRecoveryJob({ connectionString: fixture.appUrl, now: () => freedAt });
    try {
      await expect(job.drain()).resolves.toEqual({ processed: 1 });
    } finally {
      await job.close();
    }
    await expect(
      owner.query(
        `SELECT state FROM license_request WHERE id=$1`,
        [ids.requestFreed],
      ),
    ).resolves.toMatchObject({ rows: [{ state: "provisioning" }] });
  });

  it("processes two distinct same-day releases and one replay exactly twice", async () => {
    const releasedAt = new Date("2026-08-05T16:00:00.000Z");
    for (const releaseEventId of [id("121"), id("122"), id("121")]) {
      await owner.query(
        `SELECT enqueue_capacity_recovery(NULL,$1,$2,'2026-08-05','seat_freed',$3,$4)`,
        [ids.account, ids.license, releasedAt, releaseEventId],
      );
    }
    const job = createCapacityRecoveryJob({ connectionString: fixture.appUrl, now: () => releasedAt });
    try {
      await expect(job.drain()).resolves.toEqual({ processed: 2 });
      await expect(job.drain()).resolves.toEqual({ processed: 0 });
    } finally {
      await job.close();
    }
    await expect(owner.query(
      `SELECT release_event_id::text,status,attempt_count
       FROM capacity_recovery_work WHERE release_event_id IN ($1,$2)
       ORDER BY release_event_id`,
      [id("121"), id("122")],
    )).resolves.toMatchObject({
      rows: [id("121"), id("122")].map((releaseEventId) => ({
        attempt_count: 1,
        release_event_id: releaseEventId,
        status: "completed",
      })),
    });
  });

  it("does not activate tomorrow's capacity before Ecuador midnight", async () => {
    const boundary = new Date("2026-08-05T02:00:00.000Z");
    await owner.query(
      `UPDATE vendor_account_capacity SET purchased_qty=0 WHERE id=$1`,
      [ids.capacity],
    );
    await owner.query(
      `INSERT INTO vendor_account_capacity
         (vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by)
       VALUES ($1,$2,1,'2026-08-05',$3,$4)`,
      [ids.account, ids.license, boundary, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_request
         (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
          state,justification,created_at,created_by)
       VALUES ($1,'REC-BOUNDARY',$2,$3,$4,$5,'blocked_no_seat','boundary',$6,$7)`,
      [ids.requestBoundary, ids.personA, ids.companyA, ids.account, ids.license, boundary, ids.admin],
    );
    await owner.query(
      `SELECT enqueue_capacity_recovery(NULL,$1,$2,'2026-08-04','seat_freed',$3,$4)`,
      [ids.account, ids.license, boundary, id("130")],
    );
    const job = createCapacityRecoveryJob({ connectionString: fixture.appUrl, now: () => boundary });
    try {
      await expect(job.drain()).resolves.toEqual({ processed: 1 });
    } finally {
      await job.close();
    }
    await expect(
      owner.query("SELECT state FROM license_request WHERE id=$1", [ids.requestBoundary]),
    ).resolves.toMatchObject({ rows: [{ state: "blocked_no_seat" }] });
  });

  it("leaves provider-400 recovery included or durably pending when it races completion", async () => {
    await owner.query(
      `INSERT INTO vendor_account
         (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
       VALUES ($1,$2,'Race account','orchestration',1,'active',$3,$4)`,
      [ids.accountRace, ids.vendor, at, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_type
         (id,vendor_id,name,unit,status,created_at,created_by)
       VALUES ($1,$2,'Race seat','seat','active',$3,$4)`,
      [ids.licenseRace, ids.vendor, at, ids.admin],
    );
    await owner.query(
      `INSERT INTO vendor_account_capacity
         (id,vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by)
       VALUES ($1,$2,$3,1,'2026-08-04',$4,$5)`,
      [ids.capacityRace, ids.accountRace, ids.licenseRace, at, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_request
         (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
          state,justification,created_at,created_by)
       VALUES ($1,'REC-RACE',$2,$3,$4,$5,'approved','race',$6,$7)`,
      [ids.requestRace, ids.personA, ids.companyA, ids.accountRace,
        ids.licenseRace, at, ids.admin],
    );
    await owner.query(
      `SELECT enqueue_capacity_recovery($1,$2,$3,'2026-08-04','capacity_change',$4)`,
      [ids.capacityRace, ids.accountRace, ids.licenseRace, at],
    );
    const job = createCapacityRecoveryJob({ connectionString: fixture.appUrl, now: () => at });
    const orchestration = createOrchestrationService(fixture.appUrl, { now: () => at });
    try {
      await Promise.all([
        job.drain(),
        orchestration.observeProviderNoSeat(ids.requestRace),
      ]);
    } finally {
      await Promise.all([job.close(), orchestration.close()]);
    }
    const evidence = await owner.query<{
      actions: number;
      pending: number;
      state: string;
    }>(
      `SELECT request.state,
              (SELECT count(*)::int FROM provisioning_action action
               WHERE action.request_id=request.id) AS actions,
              (SELECT count(*)::int FROM capacity_recovery_work work
               WHERE work.vendor_account_id=request.vendor_account_id
                 AND work.license_type_id=request.license_type_id
                 AND work.status='pending') AS pending
       FROM license_request request WHERE request.id=$1`,
      [ids.requestRace],
    );
    const [result] = evidence.rows;
    expect(
      result?.state === "provisioning"
        ? result.actions === 1
        : result?.state === "blocked_no_seat" && result.pending >= 1,
    ).toBe(true);
  });

  it("does not overallocate when checklist confirmation races capacity recovery", async () => {
    await owner.query(
      `INSERT INTO vendor_account
         (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
       VALUES ($1,$2,'Confirmation account','orchestration',1,'active',$3,$4)`,
      [ids.accountConfirm, ids.vendor, at, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_type
         (id,vendor_id,name,unit,status,created_at,created_by)
       VALUES ($1,$2,'Confirmation seat','seat','active',$3,$4)`,
      [ids.licenseConfirm, ids.vendor, at, ids.admin],
    );
    await owner.query(
      `INSERT INTO vendor_account_capacity
         (id,vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by)
       VALUES ($1,$2,$3,1,'2026-08-04',$4,$5)`,
      [ids.capacityConfirm, ids.accountConfirm, ids.licenseConfirm, at, ids.admin],
    );
    await owner.query(
      `INSERT INTO license_request
         (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
          state,justification,created_at,created_by)
       VALUES ($1,'REC-CONFIRM',$3,$5,$7,$8,'approved','confirm',$9,$10),
              ($2,'REC-WAIT',$4,$6,$7,$8,'blocked_no_seat','wait',$9,$10)`,
      [ids.requestConfirm, ids.requestWaiting, ids.personA, ids.personB,
        ids.companyA, ids.companyB, ids.accountConfirm, ids.licenseConfirm, at, ids.admin],
    );
    await owner.query(
      `INSERT INTO request_transition
         (request_id,from_state,to_state,actor_user_id,note,occurred_at)
       VALUES ($1,'approved','blocked_no_seat',$2,'empty',$3)`,
      [ids.requestWaiting, ids.admin, at],
    );
    await owner.query(
      `SELECT enqueue_capacity_recovery($1,$2,$3,'2026-08-04','capacity_change',$4)`,
      [ids.capacityConfirm, ids.accountConfirm, ids.licenseConfirm, at],
    );
    const orchestration = createOrchestrationService(fixture.appUrl, { now: () => at });
    const authorization = {
      companyGrants: [], companyIds: [], employeeCompanyId: null,
      globalRole: "group_admin" as const, idpSubject: "recovery-admin",
      roles: ["group_admin" as const], userAccountId: ids.admin, userId: ids.admin,
    };
    const action = await orchestration.routeApprovedRequest(authorization, ids.requestConfirm);
    const job = createCapacityRecoveryJob({ connectionString: fixture.appUrl, now: () => at });
    try {
      await Promise.all([
        orchestration.confirmChecklistDone(authorization, {
          actionId: action.id,
          confirmationId: "confirmation-recovery-race",
        }),
        job.drain(),
      ]);
    } finally {
      await Promise.all([job.close(), orchestration.close()]);
    }
    await expect(owner.query(
      `SELECT
         (SELECT count(*)::int FROM license_assignment
          WHERE vendor_account_id=$1 AND license_type_id=$2) AS assignments,
         (SELECT state FROM license_request WHERE id=$3) AS waiting_state`,
      [ids.accountConfirm, ids.licenseConfirm, ids.requestWaiting],
    )).resolves.toMatchObject({
      rows: [{ assignments: 1, waiting_state: "blocked_no_seat" }],
    });
  });
});
