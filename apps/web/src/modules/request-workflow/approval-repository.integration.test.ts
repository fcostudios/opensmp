import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import {
  createConnectorDispatcher,
  type VendorConnector,
} from "@smp/connectors";
import * as schema from "@smp/db/schema";
import { createCoveredEcuadorCalendar } from "@smp/domain/request-workflow/business-time";

import {
  createAuthorizationRepository,
  type LedgerAuthorization,
} from "../identity-access/authorization";
import { decideRequestPolicy } from "./actions/decide-request-policy";
import {
  createApprovalRepository,
  createProductionApprovalRepository,
} from "./approval-repository";
import { routeApprovedRequestInTransaction } from "./orchestration";

const approverId = "10000000-0000-0000-0000-000000000001";
const adminId = "10000000-0000-0000-0000-000000000002";
const companyA = "10000000-0000-0000-0000-000000000003";
const companyB = "10000000-0000-0000-0000-000000000004";
const personA = "10000000-0000-0000-0000-000000000005";
const personB = "10000000-0000-0000-0000-000000000006";
const personA2 = "10000000-0000-0000-0000-000000000016";
const personA3 = "10000000-0000-0000-0000-000000000017";
const vendorId = "10000000-0000-0000-0000-000000000007";
const vendorAccountId = "10000000-0000-0000-0000-000000000008";
const licenseTypeId = "10000000-0000-0000-0000-000000000009";
const requestA = "10000000-0000-0000-0000-000000000010";
const requestB = "10000000-0000-0000-0000-000000000011";
const mismatchedRequest = "10000000-0000-0000-0000-000000000012";
const rejectRequest = "10000000-0000-0000-0000-000000000013";
const noRateLicenseTypeId = "10000000-0000-0000-0000-000000000014";
const noRateRequest = "10000000-0000-0000-0000-000000000015";
const assignmentA1 = "10000000-0000-0000-0000-000000000018";
const assignmentA2 = "10000000-0000-0000-0000-000000000019";
const assignmentB = "10000000-0000-0000-0000-000000000020";
const decidedAt = new Date("2026-07-28T15:00:00.000Z");
const coveredCalendar = createCoveredEcuadorCalendar({ 2026: [] });
const automatedConnector: VendorConnector = {
  capabilities: () => new Set(["provision"]),
  async provision() {
    throw new Error("connector execution belongs to the worker");
  },
  async deprovision() {
    return { code: "unsupported", checklistSteps: ["worker"], ok: false };
  },
  async syncActivity() {
    return { code: "unsupported", checklistSteps: [], ok: false };
  },
  async syncCost() {
    return { code: "unsupported", checklistSteps: [], ok: false };
  },
  async syncMembers() {
    return { code: "unsupported", checklistSteps: [], ok: false };
  },
};

let fixture: PostgresFixture | undefined;
let owner: pg.Client;
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let approver: LedgerAuthorization;
let admin: LedgerAuthorization;
let repository: ReturnType<typeof createApprovalRepository>;
let loadAuthorization: ReturnType<
  typeof createAuthorizationRepository
>["load"];
let recordAuthorizationFailure: ReturnType<
  typeof createAuthorizationRepository
>["recordAuthorizationFailure"];

beforeAll(async () => {
  const mutationAppUrl =
    process.env.US015_MUTATION_DATABASE_URL ??
    process.env.US016_MUTATION_DATABASE_URL;
  const mutationOwnerUrl =
    process.env.US015_MUTATION_DATABASE_ADMIN_URL ??
    process.env.US016_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("approval mutation harness requires both database URLs");
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
  await owner.query(
    `TRUNCATE TABLE audit_log, request_transition, license_request,
      rate_card, license_type, vendor_account, vendor,
      company_role_assignment, person, company, user_account
      RESTART IDENTITY CASCADE`,
  );

  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ($1,'approver@example.test','approval-approver',NULL,'es','active',$3),
       ($2,'admin@example.test','approval-admin','group_admin','es','active',$3)`,
    [approverId, adminId, "2026-07-24T12:00:00.000Z"],
  );
  await owner.query(
    `
     INSERT INTO company
       (id,name,code,type,status,budget_monthly_usd,statement_language,created_at,created_by)
     VALUES
       ($1,'Company A','A','internal','active',1000,'es',$4,$3),
       ($2,'Company B','B','internal','active',NULL,'es',$4,$3)`,
    [companyA, companyB, approverId, "2026-07-24T12:00:00.000Z"],
  );
  await owner.query(
    `
     INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES
       ($1,'a@example.test','Person A',$3,'active',$5,$6),
       ($2,'b@example.test','Person B',$4,'active',$5,$6),
       ($7,'a2@example.test','Person A2',$3,'active',$5,$6),
       ($8,'a3@example.test','Person A3',$3,'active',$5,$6)`,
    [
      personA,
      personB,
      companyA,
      companyB,
      "2026-07-24T12:00:00.000Z",
      approverId,
      personA2,
      personA3,
    ],
  );
  await owner.query(
    `
     INSERT INTO company_role_assignment
       (user_account_id,company_id,role,unique_grant,created_at,created_by)
     VALUES ($1,$2,'approver','approval-company-a',$3,$1)`,
    [approverId, companyA, "2026-07-24T12:00:00.000Z"],
  );
  await owner.query(
    `
     INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Vendor','orchestration','none',false,false,false,false,'email','active',$2,$3)`,
    [vendorId, "2026-07-24T12:00:00.000Z", approverId],
  );
  await owner.query(
    `
     INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Vendor Org','orchestration',1,'active',$3,$4)`,
    [vendorAccountId, vendorId, "2026-07-24T12:00:00.000Z", approverId],
  );
  await owner.query(
    `
     INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES
       ($1,$3,'Claude Team','seat','active',$4,$5),
       ($2,$3,'Claude Enterprise','seat','active',$4,$5)`,
    [
      licenseTypeId,
      noRateLicenseTypeId,
      vendorId,
      "2026-07-24T12:00:00.000Z",
      approverId,
    ],
  );
  await owner.query(
    `INSERT INTO license_assignment
       (id,person_id,company_id,vendor_account_id,license_type_id,started_on,
        source_kind,created_at,created_by)
     VALUES
       ($1,$4,$7,$8,$9,'2026-01-01','import',$10,$11),
       ($2,$5,$7,$8,$9,'2026-02-01','import',$10,$11),
       ($3,$6,$12,$8,$9,'2026-03-01','import',$10,$11)`,
    [
      assignmentA1,
      assignmentA2,
      assignmentB,
      personA2,
      personA3,
      personB,
      companyA,
      vendorAccountId,
      licenseTypeId,
      "2026-07-24T12:00:00.000Z",
      approverId,
      companyB,
    ],
  );
  await owner.query(
    `INSERT INTO vendor_account_capacity
       (vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by)
     VALUES ($1,$2,10,'2026-01-01',$3,$4)`,
    [vendorAccountId, licenseTypeId, decidedAt, approverId],
  );
  await owner.query(
    `
     INSERT INTO rate_card
       (vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by)
     VALUES ($1,$2,27.10,'2026-01-01',$3,$4)`,
    [vendorAccountId, licenseTypeId, "2026-07-24T12:00:00.000Z", approverId],
  );
  await owner.query(
    `
     INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,
        justification,needed_by,requested_by,created_at,created_by)
     VALUES
       ($1,'APR-1',$5,$7,$9,$10,'pending_approval','Scoped A','2026-08-05',$11,$13,$11),
       ($2,'APR-2',$6,$8,$9,$10,'pending_approval','Scoped B','2026-08-06',$12,$13,$12),
       ($3,'APR-X',$6,$7,$9,$10,'pending_approval','Cross-tenant person','2026-08-07',$11,$13,$11),
       ($4,'APR-3',$5,$7,$9,$10,'pending_approval','Reject me','2026-08-08',$11,$13,$11),
       ($14,'APR-4',$5,$7,$9,$15,'pending_approval','No rate yet','2026-08-09',$11,$13,$11)`,
    [
      requestA,
      requestB,
      mismatchedRequest,
      rejectRequest,
      personA,
      personB,
      companyA,
      companyB,
      vendorAccountId,
      licenseTypeId,
      approverId,
      adminId,
      "2026-07-24T15:00:00.000Z",
      noRateRequest,
      noRateLicenseTypeId,
    ],
  );

  database = drizzle(pool, { schema });
  repository = createApprovalRepository(database);
  const authRepository = createAuthorizationRepository(database);
  loadAuthorization = authRepository.load;
  recordAuthorizationFailure = authRepository.recordAuthorizationFailure;
  const loaded = await Promise.all([
    authRepository.load({ subject: "approval-approver" }),
    authRepository.load({ subject: "approval-admin" }),
  ]);
  if (!loaded[0] || !loaded[1]) throw new Error("approval fixtures unavailable");
  [approver, admin] = loaded as [LedgerAuthorization, LedgerAuthorization];
});

beforeEach(async () => {
  await owner.query(
    `TRUNCATE TABLE connector_call_observation,
       lifecycle_notification_delivery, lifecycle_notification,
       audit_log, request_transition, provisioning_action`,
  );
  await owner.query(`DELETE FROM rate_card`);
  await owner.query(
    `INSERT INTO rate_card
       (vendor_account_id,license_type_id,monthly_rate_usd,effective_from,created_at,created_by)
     VALUES ($1,$2,27.10,'2026-01-01',$3,$4)`,
    [vendorAccountId, licenseTypeId, "2026-07-24T12:00:00.000Z", approverId],
  );
  await owner.query(
    `UPDATE license_assignment SET license_type_id = $1 WHERE id = $2`,
    [licenseTypeId, assignmentB],
  );
  await owner.query(
    `UPDATE license_request
     SET state = 'pending_approval', decided_by = NULL, decided_at = NULL,
         decision_comment = NULL, updated_at = NULL`,
  );
  await owner.query(
    `UPDATE vendor
     SET connector_type = 'orchestration', provisioning_protocol = 'none',
         can_provision = false
     WHERE id = $1`,
    [vendorId],
  );
  await owner.query(
    `UPDATE vendor_account SET mode = 'orchestration' WHERE id = $1`,
    [vendorAccountId],
  );
  await owner.query(
    `UPDATE vendor_account_capacity SET purchased_qty=10
     WHERE vendor_account_id=$1 AND license_type_id=$2`,
    [vendorAccountId, licenseTypeId],
  );
});

afterAll(async () => {
  await Promise.all([pool.end(), owner.end()]);
  await fixture?.stop();
});

describe("approval queue repository", () => {
  test("production composition dispatches through its stable lifecycle worker", async () => {
    const productionRepository = createProductionApprovalRepository(database);
    await productionRepository.decide(
      approver,
      {
        requestId: rejectRequest,
        decision: "rejected",
        decisionComment: "No hay presupuesto disponible.",
      },
      new Date("2026-07-28T15:00:00.000Z"),
    );

    const journal = await owner.query(
      `SELECT phase,worker_id,error_code
       FROM lifecycle_notification_delivery delivery
       JOIN lifecycle_notification notification
         ON notification.id=delivery.notification_id
       WHERE notification.request_id=$1
       ORDER BY delivery.occurred_at,delivery.phase`,
      [rejectRequest],
    );
    expect(journal.rows).toEqual([
      {
        phase: "pending",
        worker_id: null,
        error_code: null,
      },
      {
        phase: "claimed",
        worker_id: "web-approval-decision",
        error_code: null,
      },
      {
        phase: "failed",
        worker_id: "web-approval-decision",
        error_code: "NOTIFICATION_CONFIGURATION_INVALID",
      },
    ]);
  });

  test("enqueues the requester decision notification for the rejected path", async () => {
    await repository.decide(approver, {
      requestId: rejectRequest,
      decision: "rejected",
      decisionComment: "No hay presupuesto disponible.",
    }, new Date("2026-07-28T15:00:00.000Z"));

    const notifications = await owner.query(
      `SELECT kind, request_state, company_id, recipient_email
       FROM lifecycle_notification
       WHERE request_id=$1`,
      [rejectRequest],
    );
    expect(notifications.rows).toEqual([
      {
        kind: "decision",
        request_state: "rejected",
        company_id: companyA,
        recipient_email: "approver@example.test",
      },
    ]);
  });

  test("does not acquire the capacity-pool lock for a rejected decision", async () => {
    await owner.query("BEGIN");
    await owner.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`capacity-pool:${vendorAccountId}:${licenseTypeId}`],
    );
    const client = await pool.connect();
    await client.query(`SET lock_timeout = '100ms'`);
    const lockAwareRepository = createApprovalRepository(
      drizzle(client, { schema }),
    );
    try {
      await lockAwareRepository.decide(approver, {
        requestId: rejectRequest,
        decision: "rejected",
        decisionComment: "No procede",
      }, decidedAt);
    } finally {
      await client.query("RESET lock_timeout");
      client.release();
      await owner.query("ROLLBACK");
    }

    const request = await owner.query(
      `SELECT state, decision_comment FROM license_request WHERE id = $1`,
      [rejectRequest],
    );
    expect(request.rows).toEqual([{
      decision_comment: "No procede",
      state: "rejected",
    }]);
  });

  test("acquires the capacity-pool lock before persisting an approval", async () => {
    await owner.query(
      `CREATE OR REPLACE FUNCTION reject_unlocked_approval() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'approval reached transition before pool lock';
       END;
       $$;
       CREATE TRIGGER reject_unlocked_approval
       BEFORE UPDATE ON license_request
       FOR EACH ROW EXECUTE FUNCTION reject_unlocked_approval()`,
    );
    await owner.query("BEGIN");
    await owner.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`capacity-pool:${vendorAccountId}:${licenseTypeId}`],
    );
    const client = await pool.connect();
    await client.query(`SET lock_timeout = '100ms'`);
    const lockAwareRepository = createApprovalRepository(
      drizzle(client, { schema }),
    );
    try {
      await expect(
        lockAwareRepository.decide(approver, {
          requestId: requestA,
          decision: "approved",
        }, decidedAt),
      ).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await client.query("RESET lock_timeout");
      client.release();
      await owner.query("ROLLBACK");
      await owner.query(
        `DROP TRIGGER reject_unlocked_approval ON license_request;
         DROP FUNCTION reject_unlocked_approval()`,
      );
    }

    const request = await owner.query(
      `SELECT state, decided_by FROM license_request WHERE id = $1`,
      [requestA],
    );
    expect(request.rows).toEqual([{
      decided_by: null,
      state: "pending_approval",
    }]);
  });

  test("scopes an approver to granted companies and enforces company equality in joins", async () => {
    const items = await repository.listPending(
      approver,
      decidedAt,
      coveredCalendar,
    );

    expect(items.map(({ requestId }) => requestId)).toEqual([
      requestA,
      rejectRequest,
      noRateRequest,
    ]);
    expect(items[0]).toMatchObject({
      requesterName: "Person A",
      companyName: "Company A",
      monthlyRateUsd: 27.1,
      committedRunRateUsd: 54.2,
      hasUnpricedCommitments: false,
      budgetMonthlyUsd: 1000,
      budgetHeadroomUsd: 945.8,
      projectedHeadroomUsd: 918.7,
      businessHoursPending: 48,
      decisionTargetBreached: false,
    });
    expect(items[0]?.createdAt).toBeInstanceOf(Date);
    expect(items[0]?.createdAt.toISOString()).toBe(
      "2026-07-24T15:00:00.000Z",
    );
    expect(items.find(({ requestId }) => requestId === noRateRequest)).toMatchObject({
      monthlyRateUsd: null,
      committedRunRateUsd: 54.2,
      budgetHeadroomUsd: 945.8,
      projectedHeadroomUsd: null,
    });
  });

  test.each([
    ["missing", `DELETE FROM rate_card`],
    [
      "future",
      `UPDATE rate_card SET effective_from = '2026-08-01' WHERE license_type_id = '${licenseTypeId}'`,
    ],
    [
      "expired",
      `UPDATE rate_card SET effective_to = '2026-07-27' WHERE license_type_id = '${licenseTypeId}'`,
    ],
  ])(
    "fails budget projection closed for an active assignment with a %s rate",
    async (_case, mutationSql) => {
      await owner.query(mutationSql);

      const items = await repository.listPending(
        approver,
        decidedAt,
        coveredCalendar,
      );

      expect(items.find(({ requestId }) => requestId === requestA)).toMatchObject({
        committedRunRateUsd: null,
        hasUnpricedCommitments: true,
        budgetHeadroomUsd: null,
        projectedHeadroomUsd: null,
      });
    },
  );

  test("does not let an unpriced assignment in another company poison scoped headroom", async () => {
    await owner.query(
      `UPDATE license_assignment SET license_type_id = $1 WHERE id = $2`,
      [noRateLicenseTypeId, assignmentB],
    );

    const scoped = await repository.listPending(
      approver,
      decidedAt,
      coveredCalendar,
    );
    const global = await repository.listPending(
      admin,
      decidedAt,
      coveredCalendar,
    );

    expect(scoped[0]).toMatchObject({
      committedRunRateUsd: 54.2,
      hasUnpricedCommitments: false,
      budgetHeadroomUsd: 945.8,
    });
    expect(global.find(({ requestId }) => requestId === requestB)).toMatchObject({
      committedRunRateUsd: null,
      hasUnpricedCommitments: true,
      budgetHeadroomUsd: null,
      projectedHeadroomUsd: null,
    });
  });

  test("lets a group admin see all real-company requests", async () => {
    const items = await repository.listPending(
      admin,
      decidedAt,
      coveredCalendar,
    );

    expect(items.map(({ requestId }) => requestId)).toEqual([
      requestA,
      requestB,
      rejectRequest,
      noRateRequest,
    ]);
    expect(items.find(({ requestId }) => requestId === requestB)).toMatchObject({
      monthlyRateUsd: 27.1,
      committedRunRateUsd: 27.1,
      budgetHeadroomUsd: null,
      projectedHeadroomUsd: null,
    });
  });

  test("returns no rows when the actor has no approval grant", async () => {
    const items = await repository.listPending(
      {
        ...approver,
        companyIds: [],
        roles: [],
        companyGrants: [],
        employeeCompanyId: null,
      },
      decidedAt,
      coveredCalendar,
    );

    expect(items).toEqual([]);
  });

  test("renders a valid SQL scope for multiple granted companies", async () => {
    const items = await repository.listPending(
      {
        ...approver,
        companyGrants: [
          { companyId: companyA, role: "approver" },
          { companyId: companyB, role: "approver" },
        ],
      },
      decidedAt,
      coveredCalendar,
    );

    expect(items.map(({ requestId }) => requestId)).toEqual([
      requestA,
      requestB,
      rejectRequest,
      noRateRequest,
    ]);
  });

  test("routes a company approver's approval to one canonical checklist in the same transaction", async () => {
    await repository.decide(approver, {
      requestId: requestA,
      decision: "approved",
    }, decidedAt);

    const request = await owner.query(
      `SELECT state, decided_by, decided_at, decision_comment
       FROM license_request WHERE id = $1`,
      [requestA],
    );
    const transition = await owner.query(
      `SELECT from_state, to_state, actor_user_id, occurred_at
       FROM request_transition WHERE request_id = $1`,
      [requestA],
    );
    const audit = await owner.query(
      `SELECT action, actor_user_id, company_id, before, after
       FROM audit_log
       WHERE entity_id = $1
       ORDER BY occurred_at, action`,
      [requestA],
    );
    const action = await owner.query(
      `SELECT id::text, request_id::text, vendor_account_id::text, kind, mode,
              status, raw_request
       FROM provisioning_action
       WHERE request_id = $1`,
      [requestA],
    );
    const actionAudit = await owner.query(
      `SELECT action, actor_user_id, company_id, before, after
       FROM audit_log
       WHERE entity_id = $1`,
      [action.rows[0]?.id],
    );

    expect(request.rows[0]).toEqual({
      state: "provisioning",
      decided_by: approverId,
      decided_at: decidedAt,
      decision_comment: null,
    });
    expect(transition.rows).toEqual([
      {
        from_state: "pending_approval",
        to_state: "approved",
        actor_user_id: approverId,
        occurred_at: decidedAt,
      },
      {
        from_state: "approved",
        to_state: "provisioning",
        actor_user_id: approverId,
        occurred_at: decidedAt,
      },
    ]);
    expect(audit.rows).toEqual([
      {
        action: "request.approved",
        actor_user_id: approverId,
        company_id: companyA,
        before: { state: "pending_approval" },
        after: { state: "approved" },
      },
      {
        action: "request.provisioning",
        actor_user_id: approverId,
        company_id: companyA,
        before: { state: "approved" },
        after: { state: "provisioning" },
      },
    ]);
    expect(action.rows).toEqual([
      {
        id: expect.any(String),
        request_id: requestA,
        vendor_account_id: vendorAccountId,
        kind: "checklist",
        mode: "orchestration",
        status: "pending",
        raw_request: expect.objectContaining({
          checklistSteps: expect.arrayContaining([
            {
              messageKey: "connector.manual.invite_person",
              params: expect.objectContaining({ personEmail: "a@example.test" }),
              targets: expect.objectContaining({
                personId: personA,
                requestId: requestA,
                vendorAccountId,
              }),
            },
          ]),
          context: { companyId: companyA, requestId: requestA },
          operation: "provision",
          protocol: "none",
          version: 1,
        }),
      },
    ]);
    const notifications = await owner.query(
      `SELECT kind, request_state, company_id, recipient_email
       FROM lifecycle_notification
       WHERE request_id=$1`,
      [requestA],
    );
    expect(notifications.rows).toEqual([
      {
        kind: "decision",
        request_state: "approved",
        company_id: companyA,
        recipient_email: "approver@example.test",
      },
    ]);
    expect(actionAudit.rows).toEqual([
      {
        action: "orchestration.checklist_issued",
        actor_user_id: approverId,
        company_id: companyA,
        before: null,
        after: {
          kind: "checklist",
          mode: "orchestration",
          requestId: requestA,
          status: "pending",
        },
      },
    ]);
  });

  test("routes a capable connector approval to one automated action without executing the connector", async () => {
    await owner.query(
      `UPDATE vendor
       SET connector_type = 'api', provisioning_protocol = 'rest',
           can_provision = true
       WHERE id = $1`,
      [vendorId],
    );
    await owner.query(
      `UPDATE vendor_account SET mode = 'automated' WHERE id = $1`,
      [vendorAccountId],
    );
    const dispatcher = createConnectorDispatcher();
    dispatcher.register("rest", automatedConnector);
    const automatedRepository = createApprovalRepository(database, {
      dispatcher,
    });

    await automatedRepository.decide(approver, {
      requestId: requestA,
      decision: "approved",
    }, decidedAt);
    await expect(
      automatedRepository.decide(approver, {
        requestId: requestA,
        decision: "approved",
      }, decidedAt),
    ).rejects.toThrow(`REQUEST_STATE_CONFLICT:${requestA}`);
    const replay = await database.transaction((transaction) =>
      routeApprovedRequestInTransaction(
        transaction,
        approver,
        requestA,
        decidedAt,
        dispatcher,
      )
    );

    const evidence = await owner.query(
      `SELECT request.state, action.id::text, action.kind, action.mode,
              action.status, action.raw_request,
              (SELECT count(*)::int FROM request_transition transition
               WHERE transition.request_id = request.id) AS transitions,
              (SELECT count(*)::int FROM audit_log audit
               WHERE audit.entity_id = action.id) AS action_audits,
              (SELECT note FROM request_transition transition
               WHERE transition.request_id = request.id
                 AND transition.to_state = 'provisioning') AS transition_note
       FROM license_request request
       JOIN provisioning_action action ON action.request_id = request.id
       WHERE request.id = $1`,
      [requestA],
    );
    expect(evidence.rows).toEqual([{
      action_audits: 1,
      id: expect.any(String),
      kind: "invite",
      mode: "automated",
      raw_request: {
        checklistSteps: [],
        context: { companyId: companyA, requestId: requestA },
        instruction: {
          licenseTypeName: "Claude Team",
          personEmail: "a@example.test",
          requestId: requestA,
          vendorAccountId,
        },
        operation: "provision",
        protocol: "rest",
        version: 1,
      },
      state: "provisioning",
      status: "pending",
      transition_note: "Automated provisioning action issued",
      transitions: 2,
    }]);
    expect(replay).toEqual({
      id: evidence.rows[0]?.id,
      kind: "invite",
      mode: "automated",
      rawRequest: evidence.rows[0]?.raw_request,
      status: "pending",
    });
    const issued = await owner.query(
      `SELECT action, company_id, after
       FROM audit_log
       WHERE entity_id = $1`,
      [evidence.rows[0]?.id],
    );
    expect(issued.rows).toEqual([{
      action: "orchestration.automated_action_issued",
      after: {
        kind: "invite",
        mode: "automated",
        requestId: requestA,
        status: "pending",
      },
      company_id: companyA,
    }]);
    await owner.query(
      `UPDATE provisioning_action
       SET raw_request = '{"operation":"provision"}'::jsonb
       WHERE id = $1`,
      [evidence.rows[0]?.id],
    );
    await expect(
      database.transaction((transaction) =>
        routeApprovedRequestInTransaction(
          transaction,
          approver,
          requestA,
          decidedAt,
          dispatcher,
        )
      ),
    ).rejects.toThrow();
  });

  test("blocks an approved request atomically when its canonical pool has no free seat", async () => {
    await owner.query(
      `INSERT INTO user_account
         (id,email,idp_subject,global_role,ui_language,status,created_at)
       VALUES ('00000000-0000-0000-0000-000000000001','system@ledger.invalid',
               'ledger-system',NULL,'en','active',$1)
       ON CONFLICT (id) DO NOTHING`,
      [decidedAt],
    );
    await owner.query(
      `UPDATE vendor_account_capacity SET purchased_qty=3
       WHERE vendor_account_id=$1 AND license_type_id=$2`,
      [vendorAccountId, licenseTypeId],
    );
    await repository.decide(approver, {
      requestId: requestA,
      decision: "approved",
    }, decidedAt);
    const evidence = await owner.query(
      `SELECT request.state,
              (SELECT count(*)::int FROM provisioning_action WHERE request_id=request.id) AS actions,
              (SELECT actor_user_id::text FROM request_transition
               WHERE request_id=request.id AND to_state='blocked_no_seat') AS actor
       FROM license_request request WHERE request.id=$1`,
      [requestA],
    );
    expect(evidence.rows).toEqual([{
      actions: 0,
      actor: "00000000-0000-0000-0000-000000000001",
      state: "blocked_no_seat",
    }]);
  });

  test("serializes concurrent approvals competing for the final pool seat", async () => {
    await owner.query(
      `INSERT INTO user_account
         (id,email,idp_subject,global_role,ui_language,status,created_at)
       VALUES ('00000000-0000-0000-0000-000000000001','system@ledger.invalid',
               'ledger-system',NULL,'en','active',$1)
       ON CONFLICT (id) DO NOTHING`,
      [decidedAt],
    );
    await owner.query(
      `UPDATE vendor_account_capacity SET purchased_qty=4
       WHERE vendor_account_id=$1 AND license_type_id=$2`,
      [vendorAccountId, licenseTypeId],
    );
    await owner.query(
      `UPDATE vendor SET connector_type='api',provisioning_protocol='rest',
         can_provision=true WHERE id=$1`,
      [vendorId],
    );
    await owner.query(
      `UPDATE vendor_account SET mode='automated' WHERE id=$1`,
      [vendorAccountId],
    );
    const dispatcher = createConnectorDispatcher();
    dispatcher.register("rest", automatedConnector);
    const concurrentRepository = createApprovalRepository(database, {
      dispatcher,
    });

    await Promise.all([
      concurrentRepository.decide(admin, {
        decision: "approved",
        requestId: requestA,
      }, decidedAt),
      concurrentRepository.decide(admin, {
        decision: "approved",
        requestId: requestB,
      }, decidedAt),
    ]);

    const evidence = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM provisioning_action
          WHERE request_id IN ($1,$2)) AS actions,
         (SELECT count(*)::int FROM license_request
          WHERE id IN ($1,$2) AND state='blocked_no_seat') AS blocked,
         (SELECT count(*)::int FROM license_request
          WHERE id IN ($1,$2) AND state='provisioning') AS provisioning`,
      [requestA, requestB],
    );
    expect(evidence.rows).toEqual([{ actions: 1, blocked: 1, provisioning: 1 }]);
  });

  test("reserves the final pool seat for one concurrent orchestration approval", async () => {
    await owner.query(
      `INSERT INTO user_account
         (id,email,idp_subject,global_role,ui_language,status,created_at)
       VALUES ('00000000-0000-0000-0000-000000000001','system@ledger.invalid',
               'ledger-system',NULL,'en','active',$1)
       ON CONFLICT (id) DO NOTHING`,
      [decidedAt],
    );
    await owner.query(
      `UPDATE vendor_account_capacity SET purchased_qty=4
       WHERE vendor_account_id=$1 AND license_type_id=$2`,
      [vendorAccountId, licenseTypeId],
    );

    await Promise.all([
      repository.decide(admin, {
        decision: "approved",
        requestId: requestA,
      }, decidedAt),
      repository.decide(admin, {
        decision: "approved",
        requestId: requestB,
      }, decidedAt),
    ]);

    const evidence = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM provisioning_action
          WHERE request_id IN ($1,$2) AND kind='checklist'
            AND mode='orchestration' AND status IN ('pending','sent')) AS reservations,
         (SELECT count(*)::int FROM license_request
          WHERE id IN ($1,$2) AND state='blocked_no_seat') AS blocked,
         (SELECT count(*)::int FROM license_request
          WHERE id IN ($1,$2) AND state='provisioning') AS provisioning`,
      [requestA, requestB],
    );
    expect(evidence.rows).toEqual([{ blocked: 1, provisioning: 1, reservations: 1 }]);
  });

  test("rolls an automated approval back when action persistence fails", async () => {
    await owner.query(
      `UPDATE vendor
       SET connector_type = 'api', provisioning_protocol = 'rest',
           can_provision = true
       WHERE id = $1`,
      [vendorId],
    );
    await owner.query(
      `UPDATE vendor_account SET mode = 'automated' WHERE id = $1`,
      [vendorAccountId],
    );
    const dispatcher = createConnectorDispatcher();
    dispatcher.register("rest", automatedConnector);
    const automatedRepository = createApprovalRepository(database, {
      dispatcher,
    });
    await owner.query(
      `CREATE OR REPLACE FUNCTION reject_us020_automated() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.kind = 'invite' THEN
           RAISE EXCEPTION 'forced automated action failure';
         END IF;
         RETURN NEW;
       END;
       $$;
       CREATE TRIGGER reject_us020_automated
       BEFORE INSERT ON provisioning_action
       FOR EACH ROW EXECUTE FUNCTION reject_us020_automated()`,
    );
    try {
      await expect(
        automatedRepository.decide(approver, {
          requestId: requestA,
          decision: "approved",
        }, decidedAt),
      ).rejects.toThrow("forced automated action failure");
      const evidence = await owner.query(
        `SELECT state, decided_by,
                (SELECT count(*)::int FROM provisioning_action
                 WHERE request_id = request.id) AS actions,
                (SELECT count(*)::int FROM request_transition
                 WHERE request_id = request.id) AS transitions
         FROM license_request request WHERE id = $1`,
        [requestA],
      );
      expect(evidence.rows).toEqual([{
        actions: 0,
        decided_by: null,
        state: "pending_approval",
        transitions: 0,
      }]);
    } finally {
      await owner.query(
        `DROP TRIGGER reject_us020_automated ON provisioning_action;
         DROP FUNCTION reject_us020_automated()`,
      );
    }
  });

  test("rolls the approval decision back when checklist routing fails", async () => {
    await owner.query(
      `CREATE OR REPLACE FUNCTION reject_us020_checklist() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'forced US-020 routing failure';
       END;
       $$;
       CREATE TRIGGER reject_us020_checklist
       BEFORE INSERT ON provisioning_action
       FOR EACH ROW EXECUTE FUNCTION reject_us020_checklist()`,
    );
    try {
      await expect(
        repository.decide(
          approver,
          { requestId: requestA, decision: "approved" },
          decidedAt,
        ),
      ).rejects.toThrow("forced US-020 routing failure");

      const request = await owner.query(
        `SELECT state, decided_by, decided_at
         FROM license_request WHERE id = $1`,
        [requestA],
      );
      const transitions = await owner.query(
        `SELECT count(*)::int AS count
         FROM request_transition WHERE request_id = $1`,
        [requestA],
      );
      const audits = await owner.query(
        `SELECT count(*)::int AS count
         FROM audit_log WHERE company_id = $1`,
        [companyA],
      );
      const actions = await owner.query(
        `SELECT count(*)::int AS count
         FROM provisioning_action WHERE request_id = $1`,
        [requestA],
      );
      expect(request.rows[0]).toEqual({
        state: "pending_approval",
        decided_by: null,
        decided_at: null,
      });
      expect(transitions.rows[0]?.count).toBe(0);
      expect(audits.rows[0]?.count).toBe(0);
      expect(actions.rows[0]?.count).toBe(0);
    } finally {
      await owner.query(
        `DROP TRIGGER reject_us020_checklist ON provisioning_action`,
      );
      await owner.query(`DROP FUNCTION reject_us020_checklist()`);
    }
  });

  test("rolls back decision fields and transition when audit persistence fails", async () => {
    await owner.query(
      `CREATE OR REPLACE FUNCTION reject_us015_audit() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.note = 'force audit failure' THEN
           RAISE EXCEPTION 'forced US-015 audit failure';
         END IF;
         RETURN NEW;
       END;
       $$;
       CREATE TRIGGER reject_us015_audit
       BEFORE INSERT ON audit_log
       FOR EACH ROW EXECUTE FUNCTION reject_us015_audit()`,
    );
    try {
      await expect(
        repository.decide(
          approver,
          {
            requestId: requestA,
            decision: "approved",
            decisionComment: "force audit failure",
          },
          decidedAt,
        ),
      ).rejects.toThrow("forced US-015 audit failure");

      const request = await owner.query(
        `SELECT state, decided_by, decided_at, decision_comment
         FROM license_request WHERE id = $1`,
        [requestA],
      );
      const transition = await owner.query(
        `SELECT count(*)::int AS count FROM request_transition WHERE request_id = $1`,
        [requestA],
      );
      const audit = await owner.query(
        `SELECT count(*)::int AS count FROM audit_log WHERE entity_id = $1`,
        [requestA],
      );
      expect(request.rows[0]).toEqual({
        state: "pending_approval",
        decided_by: null,
        decided_at: null,
        decision_comment: null,
      });
      expect(transition.rows[0]?.count).toBe(0);
      expect(audit.rows[0]?.count).toBe(0);
    } finally {
      await owner.query(`DROP TRIGGER reject_us015_audit ON audit_log`);
      await owner.query(`DROP FUNCTION reject_us015_audit()`);
    }
  });

  test("rejects stale concurrent decisions without adding a second transition", async () => {
    await repository.decide(approver, {
      requestId: rejectRequest,
      decision: "rejected",
      decisionComment: "No procede",
    }, decidedAt);

    await expect(
      repository.decide(approver, {
        requestId: rejectRequest,
        decision: "approved",
      }, decidedAt),
    ).rejects.toThrow(`REQUEST_STATE_CONFLICT:${rejectRequest}`);

    const request = await owner.query(
      `SELECT state, decided_by, decision_comment FROM license_request WHERE id = $1`,
      [rejectRequest],
    );
    const transitions = await owner.query(
      `SELECT count(*)::int AS count FROM request_transition WHERE request_id = $1`,
      [rejectRequest],
    );
    expect(request.rows[0]).toEqual({
      state: "rejected",
      decided_by: approverId,
      decision_comment: "No procede",
    });
    expect(transitions.rows[0]?.count).toBe(1);
    const actions = await owner.query(
      `SELECT count(*)::int AS count
       FROM provisioning_action WHERE request_id = $1`,
      [rejectRequest],
    );
    expect(actions.rows[0]?.count).toBe(0);
  });

  test("does not expose or decide another company for a scoped approver", async () => {
    await expect(
      repository.decide(approver, {
        requestId: requestB,
        decision: "approved",
      }, decidedAt),
    ).rejects.toThrow(`REQUEST_NOT_FOUND:${requestB}`);
  });

  test("lets group admin approve company B and issues one tenant-exact checklist", async () => {
    await repository.decide(
      admin,
      { requestId: requestB, decision: "approved" },
      decidedAt,
    );

    const audit = await owner.query(
      `SELECT actor_user_id, action, company_id, before, after
       FROM audit_log WHERE entity_id = $1
       ORDER BY occurred_at, action`,
      [requestB],
    );
    const action = await owner.query(
      `SELECT request_id::text, status, raw_request
       FROM provisioning_action WHERE request_id = $1`,
      [requestB],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: adminId,
        action: "request.approved",
        company_id: companyB,
        before: { state: "pending_approval" },
        after: { state: "approved" },
      },
      {
        actor_user_id: adminId,
        action: "request.provisioning",
        company_id: companyB,
        before: { state: "approved" },
        after: { state: "provisioning" },
      },
    ]);
    expect(action.rows).toEqual([
      {
        request_id: requestB,
        status: "pending",
        raw_request: expect.objectContaining({
          checklistSteps: expect.any(Array),
        }),
      },
    ]);
  });

  test("action policy rejects malformed input and missing Ledger identity", async () => {
    await expect(
      decideRequestPolicy({
        input: {
          requestId: requestA,
          decision: "rejected",
          decisionComment: " ",
        },
        subject: "approval-approver",
        loadAuthorization,
        recordAuthorizationFailure,
        repository,
        occurredAt: decidedAt,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_decision" });
    await expect(
      decideRequestPolicy({
        input: {
          requestId: requestA,
          decision: "approved",
        },
        subject: null,
        loadAuthorization,
        recordAuthorizationFailure,
        repository,
        occurredAt: decidedAt,
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(
      decideRequestPolicy({
        input: {
          requestId: requestA,
          decision: "approved",
        },
        subject: "unknown-ledger-subject",
        loadAuthorization,
        recordAuthorizationFailure,
        repository,
        occurredAt: decidedAt,
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });

    const denials = await owner.query(
      `SELECT actor_user_id, company_id, action, after
       FROM audit_log WHERE action = 'authorization.denied'
       ORDER BY occurred_at, id`,
    );
    expect(denials.rows).toEqual([
      {
        actor_user_id: null,
        company_id: companyA,
        action: "authorization.denied",
        after: {
          capability: "request:approve",
          errorCode: "capability_forbidden",
        },
      },
      {
        actor_user_id: null,
        company_id: companyA,
        action: "authorization.denied",
        after: {
          capability: "request:approve",
          errorCode: "capability_forbidden",
        },
      },
    ]);
  });

  test("action policy resolves DB authorization and enforces scoped decisions", async () => {
    await expect(
      decideRequestPolicy({
        input: {
          requestId: requestB,
          decision: "approved",
        },
        subject: "approval-approver",
        loadAuthorization,
        recordAuthorizationFailure,
        repository,
        occurredAt: decidedAt,
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });

    const request = await owner.query(
      `SELECT state, decided_by FROM license_request WHERE id = $1`,
      [requestB],
    );
    expect(request.rows[0]).toEqual({
      state: "pending_approval",
      decided_by: null,
    });
    const denial = await owner.query(
      `SELECT actor_user_id, company_id, action, after
       FROM audit_log WHERE action = 'authorization.denied'`,
    );
    expect(denial.rows).toEqual([{
      actor_user_id: approverId,
      company_id: companyB,
      action: "authorization.denied",
      after: {
        capability: "request:approve",
        errorCode: "capability_forbidden",
      },
    }]);
  });

  test("rejects a forged client company without mutation or misattributed audit", async () => {
    await expect(
      decideRequestPolicy({
        input: {
          requestId: requestB,
          companyId: companyA,
          decision: "approved",
        },
        subject: "approval-approver",
        loadAuthorization,
        recordAuthorizationFailure,
        repository,
        occurredAt: decidedAt,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_decision" });

    const [request, audit] = await Promise.all([
      owner.query(
        `SELECT state, decided_by FROM license_request WHERE id = $1`,
        [requestB],
      ),
      owner.query(
        `SELECT count(*)::int AS count FROM audit_log`,
      ),
    ]);
    expect(request.rows[0]).toEqual({
      state: "pending_approval",
      decided_by: null,
    });
    expect(audit.rows[0]?.count).toBe(0);
  });

  test("does not leak whether an unknown request exists", async () => {
    await expect(
      decideRequestPolicy({
        input: {
          requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          decision: "approved",
        },
        subject: "approval-approver",
        loadAuthorization,
        recordAuthorizationFailure,
        repository,
        occurredAt: decidedAt,
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });

    const audit = await owner.query(
      `SELECT count(*)::int AS count FROM audit_log`,
    );
    expect(audit.rows[0]?.count).toBe(0);
  });

  test("returns a generic failure for a stale real policy decision", async () => {
    await repository.decide(
      approver,
      { requestId: requestA, decision: "approved" },
      decidedAt,
    );

    await expect(
      decideRequestPolicy({
        input: { requestId: requestA, decision: "approved" },
        subject: "approval-approver",
        loadAuthorization,
        recordAuthorizationFailure,
        repository,
        occurredAt: decidedAt,
      }),
    ).resolves.toEqual({ ok: false, error: "decision_failed" });
    const actionCount = await owner.query(
      `SELECT count(*)::int AS count
       FROM provisioning_action WHERE request_id = $1`,
      [requestA],
    );
    expect(actionCount.rows[0]?.count).toBe(1);
  });

  test("action policy permits and audits the group-admin override", async () => {
    await expect(
      decideRequestPolicy({
        input: {
          requestId: requestB,
          decision: "approved",
        },
        subject: "approval-admin",
        loadAuthorization,
        recordAuthorizationFailure,
        repository,
        occurredAt: decidedAt,
      }),
    ).resolves.toEqual({ ok: true });

    const audit = await owner.query(
      `SELECT actor_user_id, company_id, action
       FROM audit_log WHERE entity_id = $1`,
      [requestB],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: adminId,
        company_id: companyB,
        action: "request.approved",
      },
      {
        actor_user_id: adminId,
        company_id: companyB,
        action: "request.provisioning",
      },
    ]);
  });
});
