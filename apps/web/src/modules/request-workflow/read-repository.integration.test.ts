import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import { createAuthorizationRepository } from "../identity-access/authorization";
import {
  createRequestReadRepository,
  currentStateAgeDays,
} from "./read-repository";
import { canDecideRequestDetail } from "./request-detail-decision-policy";

const ids = {
  admin: "13000000-0000-0000-0000-000000000001",
  employeeA: "13000000-0000-0000-0000-000000000002",
  employeeB: "13000000-0000-0000-0000-000000000003",
  approver: "13000000-0000-0000-0000-000000000004",
  finance: "13000000-0000-0000-0000-000000000005",
  companyA: "13000000-0000-0000-0000-000000000006",
  companyB: "13000000-0000-0000-0000-000000000007",
  personA: "13000000-0000-0000-0000-000000000008",
  personA2: "13000000-0000-0000-0000-000000000009",
  personB: "13000000-0000-0000-0000-000000000010",
  vendor: "13000000-0000-0000-0000-000000000011",
  vendorAccount: "13000000-0000-0000-0000-000000000012",
  licenseType: "13000000-0000-0000-0000-000000000013",
  requestA: "13000000-0000-0000-0000-000000000014",
  requestA2: "13000000-0000-0000-0000-000000000015",
  requestB: "13000000-0000-0000-0000-000000000016",
  transition1: "13000000-0000-0000-0000-000000000017",
  transition2: "13000000-0000-0000-0000-000000000018",
  transition3: "13000000-0000-0000-0000-000000000019",
  transition4: "13000000-0000-0000-0000-000000000020",
  action: "13000000-0000-0000-0000-000000000021",
  assignment: "13000000-0000-0000-0000-000000000022",
  audit: "13000000-0000-0000-0000-000000000023",
  companyC: "13000000-0000-0000-0000-000000000024",
  personC: "13000000-0000-0000-0000-000000000025",
  requestC: "13000000-0000-0000-0000-000000000026",
} as const;

let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const mutationAppUrl = process.env.US013_MUTATION_DATABASE_URL;
  const mutationOwnerUrl = process.env.US013_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("US-013 mutation harness requires both database URLs");
    }
    owner = new pg.Client({ connectionString: mutationOwnerUrl });
    await owner.connect();
    pool = new pg.Pool({ connectionString: mutationAppUrl });
  } else {
    fixture = await createPostgresFixture();
    await fixture.migrate();
    owner = await fixture.connectAsOwner();
    pool = new pg.Pool({ connectionString: fixture.appUrl });
  }
  database = drizzle(pool, { schema });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
  if (fixture) await fixture.stop();
});

beforeEach(async () => {
  await owner.query(
    `TRUNCATE TABLE audit_log, request_transition, provisioning_action,
      license_assignment, license_request, license_type, vendor_account, vendor,
      company_role_assignment, person, company, user_account
      RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ($1,'admin@ledger.test','read-admin','group_admin','es','active',$6),
       ($2,'employee-a@ledger.test','read-employee-a',NULL,'es','active',$6),
       ($3,'employee-b@ledger.test','read-employee-b',NULL,'es','active',$6),
       ($4,'approver@ledger.test','read-approver',NULL,'es','active',$6),
       ($5,'finance@ledger.test','read-finance','central_finance','es','active',$6)`,
    [
      ids.admin,
      ids.employeeA,
      ids.employeeB,
      ids.approver,
      ids.finance,
      "2026-07-20T12:00:00.000Z",
    ],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES
       ($1,'Acme','ACM','internal','active','es',$3,$4),
       ($2,'Beta','BET','internal','active','es',$3,$4),
       ($5,'Gamma','GAM','internal','active','es',$3,$4)`,
    [
      ids.companyA,
      ids.companyB,
      "2026-07-20T12:00:00.000Z",
      ids.admin,
      ids.companyC,
    ],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES
       ($1,'employee-a@ledger.test','Employee A',$4,'active',$6,$7),
       ($2,'other-a@ledger.test','Other A',$4,'active',$6,$7),
       ($3,'employee-b@ledger.test','Employee B',$5,'active',$6,$7),
       ($8,'employee-c@ledger.test','Employee C',$9,'active',$6,$7)`,
    [
      ids.personA,
      ids.personA2,
      ids.personB,
      ids.companyA,
      ids.companyB,
      "2026-07-20T12:00:00.000Z",
      ids.admin,
      ids.personC,
      ids.companyC,
    ],
  );
  await owner.query(
    `UPDATE user_account
        SET person_id = CASE id
          WHEN $1::uuid THEN $2::uuid
          WHEN $3::uuid THEN $4::uuid
          ELSE person_id
        END`,
    [ids.employeeA, ids.personA, ids.employeeB, ids.personB],
  );
  await owner.query(
    `INSERT INTO company_role_assignment
       (user_account_id,company_id,role,unique_grant,created_at,created_by)
     VALUES
       ($1,$2,'approver','read-approver-acme',$4,$5),
       ($1,$3,'approver','read-approver-beta',$4,$5),
       ($1,$6,'finance','read-finance-gamma',$4,$5)`,
    [
      ids.approver,
      ids.companyA,
      ids.companyB,
      "2026-07-20T12:00:00.000Z",
      ids.admin,
      ids.companyC,
    ],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Anthropic','orchestration','none',false,false,false,false,
       'email','active',$2,$3)`,
    [ids.vendor, "2026-07-20T12:00:00.000Z", ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Claude Org','orchestration',1,'active',$3,$4)`,
    [
      ids.vendorAccount,
      ids.vendor,
      "2026-07-20T12:00:00.000Z",
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Claude Enterprise','seat','active',$3,$4)`,
    [
      ids.licenseType,
      ids.vendor,
      "2026-07-20T12:00:00.000Z",
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,
        justification,needed_by,requested_by,decided_by,decided_at,decision_comment,
        created_at,created_by,updated_at)
     VALUES
       ($1,'SOL-1301',$4,$7,$9,$10,'blocked_no_seat','Need research','2026-08-05',
        $11,$12,'2026-07-27T12:00:00Z','Approved for research',
        '2026-07-25T12:00:00Z',$11,'2026-07-28T12:00:00Z'),
       ($2,'SOL-1302',$5,$7,$9,$10,'failed','Need writing',NULL,
        $11,NULL,NULL,NULL,'2026-07-24T12:00:00Z',$11,'2026-07-26T12:00:00Z'),
       ($3,'SOL-1303',$6,$8,$9,$10,'active','Need analysis','2026-08-01',
        $13,NULL,NULL,NULL,'2026-07-23T12:00:00Z',$13,'2026-07-27T12:00:00Z'),
       ($14,'SOL-1304',$15,$16,$9,$10,'submitted','Need finance-only tenant',NULL,
        NULL,NULL,NULL,NULL,'2026-07-22T12:00:00Z',$11,'2026-07-22T12:00:00Z')`,
    [
      ids.requestA,
      ids.requestA2,
      ids.requestB,
      ids.personA,
      ids.personA2,
      ids.personB,
      ids.companyA,
      ids.companyB,
      ids.vendorAccount,
      ids.licenseType,
      ids.employeeA,
      ids.approver,
      ids.employeeB,
      ids.requestC,
      ids.personC,
      ids.companyC,
    ],
  );
  await owner.query(
    `INSERT INTO request_transition
       (id,request_id,from_state,to_state,actor_user_id,note,occurred_at)
     VALUES
       ($1,$5,NULL,'submitted',$6,'Submitted from intake','2026-07-25T12:00:00Z'),
       ($2,$5,'submitted','pending_approval',$6,'Sent to approval','2026-07-27T12:00:00Z'),
       ($3,$5,'pending_approval','approved',$7,'Approved','2026-07-27T12:00:00Z'),
       ($4,$5,'approved','blocked_no_seat',NULL,'No seats','2026-07-28T12:00:00Z')`,
    [
      ids.transition1,
      ids.transition2,
      ids.transition3,
      ids.transition4,
      ids.requestA,
      ids.employeeA,
      ids.approver,
    ],
  );
  await owner.query(
    `INSERT INTO provisioning_action
       (id,request_id,vendor_account_id,kind,mode,status,failure_reason,
        raw_request,raw_response,sent_at,resolved_at,created_at)
     VALUES
       ($1,$2,$3,'checklist','orchestration','failed','Console rejected invite',
        '{"checklist_steps":["invite"]}'::jsonb,'{"ok":false}'::jsonb,
        '2026-07-28T12:10:00Z','2026-07-28T12:20:00Z','2026-07-28T12:05:00Z')`,
    [ids.action, ids.requestA, ids.vendorAccount],
  );
  await owner.query(
    `INSERT INTO license_assignment
       (id,person_id,company_id,vendor_account_id,license_type_id,started_on,
        source_request_id,source_kind,note,created_at,created_by)
     VALUES ($1,$2,$3,$4,$5,'2026-07-29',$6,'request','Created from request',
       '2026-07-29T12:00:00Z',$7)`,
    [
      ids.assignment,
      ids.personA,
      ids.companyA,
      ids.vendorAccount,
      ids.licenseType,
      ids.requestA,
      ids.admin,
    ],
  );
  await owner.query(
    `UPDATE license_request SET license_assignment_id=$1 WHERE id=$2`,
    [ids.assignment, ids.requestA],
  );
  await owner.query(
    `INSERT INTO audit_log
       (id,actor_user_id,action,entity_type,entity_id,company_id,note,before,after,occurred_at)
     VALUES ($1,$2,'request.blocked_no_seat','LicenseRequest',$3,$4,'Capacity exhausted',
       '{"state":"approved"}','{"state":"blocked_no_seat"}','2026-07-28T12:00:00Z')`,
    [ids.audit, ids.admin, ids.requestA, ids.companyA],
  );
});

async function authorization(subject: string) {
  const result = await createAuthorizationRepository(database).load({ subject });
  expect(result).not.toBeNull();
  return result!;
}

describe("request read repository", () => {
  test("counts blocked and failed exceptions in one tenant-scoped projection", async () => {
    const repository = createRequestReadRepository(database, () =>
      new Date("2026-07-30T12:00:00.000Z"),
    );
    await expect(
      repository.countOperationalExceptions(
        await authorization("read-employee-a"),
      ),
    ).resolves.toEqual({ blocked: BigInt(1), failed: BigInt(1) });
    await expect(
      repository.countOperationalExceptions(
        await authorization("read-employee-b"),
      ),
    ).resolves.toEqual({ blocked: BigInt(0), failed: BigInt(0) });
  });

  test("reads a bounded tenant-scoped blocked projection without detail queries", async () => {
    const repository = createRequestReadRepository(database, () =>
      new Date("2026-07-30T12:00:00.000Z"),
    );

    await expect(
      repository.listBlockedExceptions(
        await authorization("read-employee-a"),
        { limit: 10 },
      ),
    ).resolves.toEqual({
      items: [
        {
          blockedAt: "2026-07-28T12:00:00.000Z",
          companyName: "Acme",
          daysBlocked: 2,
          id: ids.requestA,
          licenseTypeId: ids.licenseType,
          licenseTypeName: "Claude Enterprise",
          neededBy: "2026-08-05",
          personName: "Employee A",
          requestNo: "SOL-1301",
          status: "blocked_no_seat",
          vendorAccountId: ids.vendorAccount,
          vendorAccountName: "Claude Org",
        },
      ],
      nextCursor: null,
    });
    await expect(
      repository.listBlockedExceptions(
        await authorization("read-employee-b"),
        { limit: 10 },
      ),
    ).resolves.toEqual({ items: [], nextCursor: null });

    await owner.query(
      `UPDATE license_request
       SET state = 'blocked_no_seat'
       WHERE id = $1`,
      [ids.requestA2],
    );
    await owner.query(
      `INSERT INTO request_transition
         (id,request_id,from_state,to_state,actor_user_id,note,occurred_at)
       VALUES
         ('13000000-0000-0000-0000-000000000027',$1,'approved',
          'blocked_no_seat',NULL,'No seats','2026-07-27T12:00:00Z')`,
      [ids.requestA2],
    );
    const approver = await authorization("read-approver");
    const first = await repository.listBlockedExceptions(approver, {
      limit: 1,
    });
    expect(first.items.map(({ id }) => id)).toEqual([ids.requestA]);
    expect(first.nextCursor).toBe(
      `2026-07-28T12:00:00.000Z|${ids.requestA}`,
    );
    await expect(
      repository.listBlockedExceptions(approver, {
        cursor: first.nextCursor,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      items: [{ id: ids.requestA2 }],
      nextCursor: null,
    });
    await expect(
      repository.listBlockedExceptions(approver, {
        cursor: "invalid",
        limit: 2,
      }),
    ).resolves.toMatchObject({
      items: [{ id: ids.requestA }, { id: ids.requestA2 }],
      nextCursor: null,
    });
    for (const cursor of [
      `|${ids.requestA}`,
      `not-a-date|${ids.requestA}`,
      "2026-07-28T12:00:00.000Z|not-a-uuid",
    ]) {
      await expect(
        repository.listBlockedExceptions(approver, { cursor, limit: 2 }),
      ).resolves.toMatchObject({
        items: [{ id: ids.requestA }, { id: ids.requestA2 }],
      });
    }
    await expect(
      repository.listBlockedExceptions(approver, { limit: 0 }),
    ).resolves.toMatchObject({
      items: [{ id: ids.requestA }],
      nextCursor: expect.any(String),
    });
  });

  test("clamps current-state age and counts only complete elapsed days", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(currentStateAgeDays(now, null)).toBe(0);
    expect(
      currentStateAgeDays(now, "2026-07-31T12:00:00.000Z"),
    ).toBe(0);
    expect(
      currentStateAgeDays(now, "2026-07-29T12:00:01.000Z"),
    ).toBe(0);
    expect(
      currentStateAgeDays(now, "2026-07-29T12:00:00.000Z"),
    ).toBe(1);
  });

  test("scopes list rows to employee person, approver grants, or group admin", async () => {
    const repository = createRequestReadRepository(database, () =>
      new Date("2026-07-30T12:00:00.000Z"),
    );

    await expect(
      repository.list(await authorization("read-employee-a")),
    ).resolves.toEqual([
      {
        companyName: "Acme",
        decidedAt: "2026-07-27T12:00:00.000Z",
        id: ids.requestA,
        licenseTypeName: "Claude Enterprise",
        neededBy: "2026-08-05",
        personName: "Employee A",
        requestNo: "SOL-1301",
        state: "blocked_no_seat",
        submittedAt: "2026-07-25T12:00:00.000Z",
        vendorAccountName: "Claude Org",
      },
    ]);
    await expect(
      repository.list(await authorization("read-employee-b")),
    ).resolves.toEqual([
      {
        companyName: "Beta",
        decidedAt: null,
        id: ids.requestB,
        licenseTypeName: "Claude Enterprise",
        neededBy: "2026-08-01",
        personName: "Employee B",
        requestNo: "SOL-1303",
        state: "active",
        submittedAt: "2026-07-23T12:00:00.000Z",
        vendorAccountName: "Claude Org",
      },
    ]);
    await expect(
      repository.list(await authorization("read-approver")),
    ).resolves.toEqual([
      expect.objectContaining({ id: ids.requestA }),
      expect.objectContaining({ id: ids.requestA2 }),
      expect.objectContaining({ id: ids.requestB }),
    ]);
    expect(
      (await repository.list(await authorization("read-admin"))).map(
        ({ id }) => id,
      ),
    ).toEqual([ids.requestA, ids.requestA2, ids.requestB, ids.requestC]);
    await expect(
      repository.list(await authorization("read-finance")),
    ).resolves.toEqual([]);
    await expect(
      repository.detail(
        await authorization("read-approver"),
        ids.requestC,
      ),
    ).resolves.toBeNull();

    const withoutTransitions = await repository.detail(
      await authorization("read-approver"),
      ids.requestA2,
    );
    expect(withoutTransitions?.timeline).toEqual([]);
    expect(withoutTransitions?.stateAgeDays).toBe(0);
  });

  test("returns the same non-leaking result for absent and out-of-scope direct URLs", async () => {
    const repository = createRequestReadRepository(database, () =>
      new Date("2026-07-30T12:00:00.000Z"),
    );
    const employee = await authorization("read-employee-b");

    await expect(repository.detail(employee, ids.requestA)).resolves.toBeNull();
    await expect(
      repository.detail(
        employee,
        "13000000-0000-0000-0000-000000000099",
      ),
    ).resolves.toBeNull();
    await expect(repository.detail(employee, "not-a-uuid")).resolves.toBeNull();
  });

  test("projects the complete ordered record with deterministic tie-breaking and injected age", async () => {
    const repository = createRequestReadRepository(database, () =>
      new Date("2026-07-30T12:00:00.000Z"),
    );
    const detail = await repository.detail(
      await authorization("read-employee-a"),
      ids.requestA,
    );

    expect(detail).toMatchObject({
      id: ids.requestA,
      requestNo: "SOL-1301",
      state: "blocked_no_seat",
      stateAgeDays: 2,
      createdAt: "2026-07-25T12:00:00.000Z",
      decidedAt: "2026-07-27T12:00:00.000Z",
      decidedBy: "approver@ledger.test",
      decisionComment: "Approved for research",
      justification: "Need research",
      neededBy: "2026-08-05",
      requestedBy: "Employee A",
      updatedAt: "2026-07-28T12:00:00.000Z",
      person: { id: ids.personA, fullName: "Employee A" },
      company: { id: ids.companyA, code: "ACM", name: "Acme" },
      vendorAccount: { id: ids.vendorAccount, name: "Claude Org" },
      licenseType: { id: ids.licenseType, name: "Claude Enterprise" },
      assignment: {
        id: ids.assignment,
        startedOn: "2026-07-29",
        endedOn: null,
      },
    });
    expect(detail?.timeline).toEqual([
      {
        actor: "Employee A",
        from: null,
        id: ids.transition1,
        note: "Submitted from intake",
        occurredAt: "2026-07-25T12:00:00.000Z",
        to: "submitted",
      },
      {
        actor: "Employee A",
        from: "submitted",
        id: ids.transition2,
        note: "Sent to approval",
        occurredAt: "2026-07-27T12:00:00.000Z",
        to: "pending_approval",
      },
      {
        actor: "approver@ledger.test",
        from: "pending_approval",
        id: ids.transition3,
        note: "Approved",
        occurredAt: "2026-07-27T12:00:00.000Z",
        to: "approved",
      },
      {
        actor: null,
        from: "approved",
        id: ids.transition4,
        note: "No seats",
        occurredAt: "2026-07-28T12:00:00.000Z",
        to: "blocked_no_seat",
      },
    ]);
    expect(detail?.warnings).toEqual([]);
    expect(detail?.actions).toEqual([
      {
        createdAt: "2026-07-28T12:05:00.000Z",
        id: ids.action,
        failureReason: "Console rejected invite",
        kind: "checklist",
        mode: "orchestration",
        rawRequest: null,
        rawResponse: null,
        resolvedAt: "2026-07-28T12:20:00.000Z",
        sentAt: "2026-07-28T12:10:00.000Z",
        status: "failed",
        vendorRef: null,
      },
    ]);
    expect(detail?.audit).toEqual([]);
  });

  test("includes the company-scoped audit slice only for group admin", async () => {
    const repository = createRequestReadRepository(database, () =>
      new Date("2026-07-30T12:00:00.000Z"),
    );
    const detail = await repository.detail(
      await authorization("read-admin"),
      ids.requestA,
    );
    expect(detail?.audit).toEqual([
      {
        occurredAt: "2026-07-28T12:00:00.000Z",
        id: ids.audit,
        action: "request.blocked_no_seat",
        actor: "admin@ledger.test",
        entityType: "LicenseRequest",
        note: "Capacity exhausted",
      },
    ]);
    expect(detail?.actions[0]).toMatchObject({
      rawRequest: { checklist_steps: ["invite"] },
      rawResponse: { ok: false },
    });
  });

  test("derives detail decision controls from persisted company grants", async () => {
    const [admin, employee, approver, finance] = await Promise.all([
      authorization("read-admin"),
      authorization("read-employee-a"),
      authorization("read-approver"),
      authorization("read-finance"),
    ]);

    expect(
      canDecideRequestDetail(approver, ids.companyA, "pending_approval"),
    ).toBe(true);
    expect(
      canDecideRequestDetail(approver, ids.companyC, "pending_approval"),
    ).toBe(false);
    expect(
      canDecideRequestDetail(admin, ids.companyC, "pending_approval"),
    ).toBe(true);
    expect(
      canDecideRequestDetail(employee, ids.companyA, "pending_approval"),
    ).toBe(false);
    expect(
      canDecideRequestDetail(finance, ids.companyC, "pending_approval"),
    ).toBe(false);
  });

  test("projects detail from one repeatable-read snapshot during a concurrent commit", async () => {
    const writerTransition = "13000000-0000-0000-0000-000000000027";
    const writerAction = "13000000-0000-0000-0000-000000000028";
    let writerCommitted = false;
    const repository = createRequestReadRepository(
      database,
      () => new Date("2026-07-30T12:00:00.000Z"),
      {
        afterBaseRead: async (transaction) => {
          const isolation = await transaction.execute<{
            readonly transaction_isolation: string;
          }>(sql`SHOW transaction_isolation`);
          const readOnly = await transaction.execute<{
            readonly transaction_read_only: string;
          }>(sql`SHOW transaction_read_only`);
          expect(isolation.rows).toEqual([
            { transaction_isolation: "repeatable read" },
          ]);
          expect(readOnly.rows).toEqual([{ transaction_read_only: "on" }]);
          if (writerCommitted) return;
          await owner.query("BEGIN");
          try {
            await owner.query(
              `UPDATE license_request
                  SET state='approved', updated_at='2026-07-30T11:00:00Z'
                WHERE id=$1`,
              [ids.requestA],
            );
            await owner.query(
              `INSERT INTO request_transition
                 (id,request_id,from_state,to_state,actor_user_id,note,occurred_at)
               VALUES ($1,$2,'blocked_no_seat','approved',$3,'Concurrent approval',
                 '2026-07-30T11:00:00Z')`,
              [writerTransition, ids.requestA, ids.admin],
            );
            await owner.query(
              `INSERT INTO provisioning_action
                 (id,request_id,vendor_account_id,kind,mode,status,created_at)
               VALUES ($1,$2,$3,'invite','orchestration','pending',
                 '2026-07-30T11:01:00Z')`,
              [writerAction, ids.requestA, ids.vendorAccount],
            );
            await owner.query("COMMIT");
            writerCommitted = true;
          } catch (error) {
            await owner.query("ROLLBACK");
            throw error;
          }
        },
      },
    );

    const first = await repository.detail(
      await authorization("read-admin"),
      ids.requestA,
    );
    expect(first?.state).toBe("blocked_no_seat");
    expect(first?.timeline.map((item) => item.id)).not.toContain(
      writerTransition,
    );
    expect(first?.actions.map((item) => item.id)).not.toContain(writerAction);

    const second = await repository.detail(
      await authorization("read-admin"),
      ids.requestA,
    );
    expect(second?.state).toBe("approved");
    expect(second?.timeline.map((item) => item.id)).toContain(writerTransition);
    expect(second?.actions.map((item) => item.id)).toContain(writerAction);
  });
});
