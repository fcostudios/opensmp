import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import { REQUEST_TRANSITIONS } from "@smp/domain";

import {
  createAuthorizationRepository,
  type LedgerAuthorization,
} from "../identity-access/authorization";
import { transitionRequest } from "./service";

const actorId = "00000000-0000-0000-0000-000000000901";
const companyA = "00000000-0000-0000-0000-000000000902";
const companyB = "00000000-0000-0000-0000-000000000903";
const personA = "00000000-0000-0000-0000-000000000904";
const personB = "00000000-0000-0000-0000-000000000905";
const vendorId = "00000000-0000-0000-0000-000000000906";
const vendorAccountId = "00000000-0000-0000-0000-000000000907";
const licenseTypeId = "00000000-0000-0000-0000-000000000908";
const grantId = "00000000-0000-0000-0000-000000000909";
const spoofedActorId = "00000000-0000-0000-0000-000000000910";
const approvedRequestId = "00000000-0000-0000-0000-000000000911";
const conflictRequestId = "00000000-0000-0000-0000-000000000912";
const illegalRequestId = "00000000-0000-0000-0000-000000000913";
const tenantBRequestId = "00000000-0000-0000-0000-000000000914";
const spoofedActorRequestId =
  "00000000-0000-0000-0000-000000000915";
const nullActorRequestId = "00000000-0000-0000-0000-000000000916";
const auditFailureRequestId =
  "00000000-0000-0000-0000-000000000917";
const concurrentRequestId =
  "00000000-0000-0000-0000-000000000918";
const globalRequestId = "00000000-0000-0000-0000-000000000919";
const groupAdminId = "00000000-0000-0000-0000-000000000920";
const noGrantId = "00000000-0000-0000-0000-000000000921";
const multiGrantId = "00000000-0000-0000-0000-000000000922";
const noGrantRequestId = "00000000-0000-0000-0000-000000000923";
const multiGrantRequestId =
  "00000000-0000-0000-0000-000000000924";
const invalidStateRequestId =
  "00000000-0000-0000-0000-000000000925";
const multiGrantAId = "00000000-0000-0000-0000-000000000926";
const multiGrantBId = "00000000-0000-0000-0000-000000000927";
const skippedUpdateRequestId =
  "00000000-0000-0000-0000-000000000928";
const approvedAt = new Date("2026-07-27T14:15:00.000Z");
const approvedTransitionApplication =
  "us014-approved-transition";
const rejectedTransitionApplication =
  "us014-rejected-transition";
const transitionBlockerApplication = "us014-transition-blocker";
const transitionObserverApplication = "us014-transition-observer";

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;
let authorization: LedgerAuthorization;
let groupAdminAuthorization: LedgerAuthorization;
let noGrantAuthorization: LedgerAuthorization;
let multiGrantAuthorization: LedgerAuthorization;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  appPool = new pg.Pool({ connectionString: fixture.appUrl });

  await owner.query(
    `INSERT INTO user_account
       (id, email, idp_subject, ui_language, status, created_at)
     VALUES
       ($1, 'workflow.approver@corporativo.example', 'workflow-approver',
        'es', 'active', '2026-07-27T12:00:00.000Z'),
       ($2, 'workflow.spoofed@corporativo.example', 'workflow-spoofed',
        'es', 'active', '2026-07-27T12:00:00.000Z'),
       ($3, 'workflow.admin@corporativo.example', 'workflow-admin',
        'es', 'active', '2026-07-27T12:00:00.000Z'),
       ($4, 'workflow.nogrant@corporativo.example', 'workflow-nogrant',
        'es', 'active', '2026-07-27T12:00:00.000Z'),
       ($5, 'workflow.multigrant@corporativo.example', 'workflow-multigrant',
        'es', 'active', '2026-07-27T12:00:00.000Z')`,
    [
      actorId,
      spoofedActorId,
      groupAdminId,
      noGrantId,
      multiGrantId,
    ],
  );
  await owner.query(
    `UPDATE user_account
     SET global_role = 'group_admin'
     WHERE id = $1`,
    [groupAdminId],
  );
  await owner.query(
    `INSERT INTO company
       (id, code, name, type, status, budget_monthly_usd,
        statement_language, created_at, created_by)
     VALUES
       ($1, 'WFA', 'Workflow Company A', 'internal', 'active', 1000,
        'es', '2026-07-27T12:00:00.000Z', $3),
       ($2, 'WFB', 'Workflow Company B', 'internal', 'active', 1000,
        'es', '2026-07-27T12:00:00.000Z', $3)`,
    [companyA, companyB, actorId],
  );
  await owner.query(
    `INSERT INTO person
       (id, email, full_name, company_id, status, created_at, created_by)
     VALUES
       ($1, 'person.a@corporativo.example', 'Person A', $3, 'active',
        '2026-07-27T12:00:00.000Z', $5),
       ($2, 'person.b@corporativo.example', 'Person B', $4, 'active',
        '2026-07-27T12:00:00.000Z', $5)`,
    [personA, personB, companyA, companyB, actorId],
  );
  await owner.query(
    `INSERT INTO company_role_assignment
       (id, user_account_id, company_id, role, unique_grant,
        created_at, created_by)
     VALUES
       ($1, $2, $3, 'approver', 'workflow-approver-company-a',
        '2026-07-27T12:00:00.000Z', $2),
       ($4, $5, $3, 'approver', 'workflow-multigrant-company-a',
        '2026-07-27T12:00:00.000Z', $5),
       ($6, $5, $7, 'approver', 'workflow-multigrant-company-b',
        '2026-07-27T12:00:00.000Z', $5)`,
    [
      grantId,
      actorId,
      companyA,
      multiGrantAId,
      multiGrantId,
      multiGrantBId,
      companyB,
    ],
  );
  await owner.query(
    `INSERT INTO vendor
       (id, name, connector_type, provisioning_protocol, can_provision,
        can_deprovision, has_usage_data, has_cost_data, identity_matching,
        status, created_at, created_by)
     VALUES
       ($1, 'Workflow Vendor', 'orchestration', 'none', false, false,
        false, false, 'email', 'active',
        '2026-07-27T12:00:00.000Z', $2)`,
    [vendorId, actorId],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id, vendor_id, name, mode, low_pool_floor, status, created_at,
        created_by)
     VALUES
       ($1, $2, 'Workflow Account', 'orchestration', 1, 'active',
        '2026-07-27T12:00:00.000Z', $3)`,
    [vendorAccountId, vendorId, actorId],
  );
  await owner.query(
    `INSERT INTO license_type
       (id, vendor_id, name, unit, status, created_at, created_by)
     VALUES
       ($1, $2, 'Workflow Seat', 'seat', 'active',
        '2026-07-27T12:00:00.000Z', $3)`,
    [licenseTypeId, vendorId, actorId],
  );
  await owner.query(
    `INSERT INTO license_request
       (id, request_no, person_id, company_id, vendor_account_id,
        license_type_id, state, justification, requested_by, created_at,
        created_by)
     VALUES
       ($1, 'WF-001', $5, $7, $9, $10, 'pending_approval',
        'Approval happy path', $11, '2026-07-27T12:00:00.000Z', $11),
       ($2, 'WF-002', $5, $7, $9, $10, 'approved',
        'Stale command', $11, '2026-07-27T12:00:00.000Z', $11),
       ($3, 'WF-003', $5, $7, $9, $10, 'approved',
        'Illegal command', $11, '2026-07-27T12:00:00.000Z', $11),
       ($4, 'WF-004', $6, $8, $9, $10, 'pending_approval',
        'Other tenant', $11, '2026-07-27T12:00:00.000Z', $11)`,
    [
      approvedRequestId,
      conflictRequestId,
      illegalRequestId,
      tenantBRequestId,
      personA,
      personB,
      companyA,
      companyB,
      vendorAccountId,
      licenseTypeId,
      actorId,
    ],
  );
  await owner.query(
    `INSERT INTO license_request
       (id, request_no, person_id, company_id, vendor_account_id,
        license_type_id, state, justification, requested_by, created_at,
        created_by)
     VALUES
       ($1, 'WF-005', $5, $6, $7, $8, 'pending_approval',
        'Spoofed actor', $9, '2026-07-27T12:00:00.000Z', $9),
       ($2, 'WF-006', $5, $6, $7, $8, 'pending_approval',
        'Null actor', $9, '2026-07-27T12:00:00.000Z', $9),
       ($3, 'WF-007', $5, $6, $7, $8, 'pending_approval',
        'Audit rollback', $9, '2026-07-27T12:00:00.000Z', $9),
       ($4, 'WF-008', $5, $6, $7, $8, 'pending_approval',
        'Concurrent decision', $9, '2026-07-27T12:00:00.000Z', $9)`,
    [
      spoofedActorRequestId,
      nullActorRequestId,
      auditFailureRequestId,
      concurrentRequestId,
      personA,
      companyA,
      vendorAccountId,
      licenseTypeId,
      actorId,
    ],
  );
  await owner.query(
    `INSERT INTO license_request
       (id, request_no, person_id, company_id, vendor_account_id,
        license_type_id, state, justification, requested_by, created_at,
        created_by)
     VALUES
       ($1, 'WF-009', $6, $8, $9, $10, 'pending_approval',
        'Global administrator', $11, '2026-07-27T12:00:00.000Z', $11),
       ($2, 'WF-010', $5, $7, $9, $10, 'pending_approval',
        'No company grant', $11, '2026-07-27T12:00:00.000Z', $11),
       ($3, 'WF-011', $6, $8, $9, $10, 'pending_approval',
        'Multiple company grants', $11, '2026-07-27T12:00:00.000Z', $11),
       ($4, 'WF-013', $5, $7, $9, $10, 'pending_approval',
        'Skipped update', $11, '2026-07-27T12:00:00.000Z', $11)`,
    [
      globalRequestId,
      noGrantRequestId,
      multiGrantRequestId,
      skippedUpdateRequestId,
      personA,
      personB,
      companyA,
      companyB,
      vendorAccountId,
      licenseTypeId,
      actorId,
    ],
  );

  const database = drizzle(appPool, { schema });
  const authorizationRepository = createAuthorizationRepository(database);
  const contexts = await Promise.all([
    authorizationRepository.load({ subject: "workflow-approver" }),
    authorizationRepository.load({ subject: "workflow-admin" }),
    authorizationRepository.load({ subject: "workflow-nogrant" }),
    authorizationRepository.load({ subject: "workflow-multigrant" }),
  ]);
  if (contexts.some((context) => context === null)) {
    throw new Error("workflow authorization fixtures were not loaded");
  }
  [
    authorization,
    groupAdminAuthorization,
    noGrantAuthorization,
    multiGrantAuthorization,
  ] = contexts as [
    LedgerAuthorization,
    LedgerAuthorization,
    LedgerAuthorization,
    LedgerAuthorization,
  ];
});

afterAll(async () => {
  await Promise.all([appPool.end(), owner.end()]);
  await fixture.stop();
}, 150_000);

describe("US-014 transitionRequest", () => {
  test("atomically approves a request and appends exact transition and audit evidence", async () => {
    const database = drizzle(appPool, { schema });

    await transitionRequest(database, authorization, {
      requestId: approvedRequestId,
      from: "pending_approval",
      to: "approved",
      actorUserId: actorId,
      note: "Budget owner approved",
      occurredAt: approvedAt,
    });

    const request = await owner.query(
      "SELECT state FROM license_request WHERE id = $1",
      [approvedRequestId],
    );
    expect(request.rows).toEqual([{ state: "approved" }]);

    const transition = await owner.query(
      `SELECT request_id, from_state, to_state, actor_user_id, note,
              occurred_at
       FROM request_transition
       WHERE request_id = $1`,
      [approvedRequestId],
    );
    expect(transition.rows).toEqual([
      {
        request_id: approvedRequestId,
        from_state: "pending_approval",
        to_state: "approved",
        actor_user_id: actorId,
        note: "Budget owner approved",
        occurred_at: approvedAt,
      },
    ]);

    const audit = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id,
              note, before, after, occurred_at
       FROM audit_log
       WHERE entity_id = $1`,
      [approvedRequestId],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: actorId,
        action: "request.approved",
        entity_type: "LicenseRequest",
        entity_id: approvedRequestId,
        company_id: companyA,
        note: "Budget owner approved",
        before: { state: "pending_approval" },
        after: { state: "approved" },
        occurred_at: approvedAt,
      },
    ]);
  });

  test("rejects a stale from-state without partial writes", async () => {
    const database = drizzle(appPool, { schema });

    await expect(
      transitionRequest(database, authorization, {
        requestId: conflictRequestId,
        from: "pending_approval",
        to: "rejected",
        actorUserId: actorId,
        note: "Stale browser decision",
        occurredAt: new Date("2026-07-27T14:16:00.000Z"),
      }),
    ).rejects.toThrow(
      `REQUEST_STATE_CONFLICT:${conflictRequestId}:pending_approval:approved`,
    );

    await expectNoPartialWrites(conflictRequestId, "approved");
  });

  test("rejects an illegal graph edge without partial writes", async () => {
    const database = drizzle(appPool, { schema });

    await expect(
      transitionRequest(database, authorization, {
        requestId: illegalRequestId,
        from: "approved",
        to: "active",
        actorUserId: actorId,
        note: null,
        occurredAt: new Date("2026-07-27T14:17:00.000Z"),
      }),
    ).rejects.toThrow("ILLEGAL_REQUEST_TRANSITION:approved:active");

    await expectNoPartialWrites(illegalRequestId, "approved");
  });

  test("cannot see or mutate a request outside the DB-resolved company grants", async () => {
    const database = drizzle(appPool, { schema });

    await expect(
      transitionRequest(database, authorization, {
        requestId: tenantBRequestId,
        from: "pending_approval",
        to: "approved",
        actorUserId: actorId,
        note: "Cross-company attempt",
        occurredAt: new Date("2026-07-27T14:18:00.000Z"),
      }),
    ).rejects.toThrow(`REQUEST_NOT_FOUND:${tenantBRequestId}`);

    await expectNoPartialWrites(tenantBRequestId, "pending_approval");
  });

  test("allows a DB-resolved group administrator to transition across companies", async () => {
    const database = drizzle(appPool, { schema });

    await transitionRequest(database, groupAdminAuthorization, {
      requestId: globalRequestId,
      from: "pending_approval",
      to: "approved",
      actorUserId: groupAdminId,
      note: "Global approval",
      occurredAt: new Date("2026-07-27T14:18:30.000Z"),
    });

    const result = await owner.query(
      `SELECT
         request.state,
         transition.actor_user_id,
         audit.company_id
       FROM license_request AS request
       INNER JOIN request_transition AS transition
         ON transition.request_id = request.id
       INNER JOIN audit_log AS audit
         ON audit.entity_id = request.id
       WHERE request.id = $1`,
      [globalRequestId],
    );
    expect(result.rows).toEqual([
      {
        state: "approved",
        actor_user_id: groupAdminId,
        company_id: companyB,
      },
    ]);
  });

  test("fails closed with the stable not-found contract when no company is permitted", async () => {
    const database = drizzle(appPool, { schema });

    await expect(
      transitionRequest(database, noGrantAuthorization, {
        requestId: noGrantRequestId,
        from: "pending_approval",
        to: "approved",
        actorUserId: noGrantId,
        note: null,
        occurredAt: new Date("2026-07-27T14:18:40.000Z"),
      }),
    ).rejects.toThrow(`REQUEST_NOT_FOUND:${noGrantRequestId}`);

    await expectNoPartialWrites(
      noGrantRequestId,
      "pending_approval",
    );
  });

  test("matches every UUID in a DB-resolved multi-company grant set", async () => {
    const database = drizzle(appPool, { schema });

    await transitionRequest(database, multiGrantAuthorization, {
      requestId: multiGrantRequestId,
      from: "pending_approval",
      to: "approved",
      actorUserId: multiGrantId,
      note: "Second granted company",
      occurredAt: new Date("2026-07-27T14:18:50.000Z"),
    });

    const result = await owner.query(
      `SELECT request.state, transition.actor_user_id, audit.company_id
       FROM license_request AS request
       INNER JOIN request_transition AS transition
         ON transition.request_id = request.id
       INNER JOIN audit_log AS audit
         ON audit.entity_id = request.id
       WHERE request.id = $1`,
      [multiGrantRequestId],
    );
    expect(result.rows).toEqual([
      {
        state: "approved",
        actor_user_id: multiGrantId,
        company_id: companyB,
      },
    ]);
  });

  test("rejects a spoofed existing actor without partial writes", async () => {
    const database = drizzle(appPool, { schema });

    await expect(
      transitionRequest(database, authorization, {
        requestId: spoofedActorRequestId,
        from: "pending_approval",
        to: "approved",
        actorUserId: spoofedActorId,
        note: "Forged actor",
        occurredAt: new Date("2026-07-27T14:19:00.000Z"),
      }),
    ).rejects.toThrow("TRANSITION_ACTOR_MISMATCH");

    await expectNoPartialWrites(
      spoofedActorRequestId,
      "pending_approval",
    );
  });

  test("rejects a null human actor without partial writes", async () => {
    const database = drizzle(appPool, { schema });

    await expect(
      transitionRequest(database, authorization, {
        requestId: nullActorRequestId,
        from: "pending_approval",
        to: "approved",
        actorUserId: null,
        note: "Missing actor",
        occurredAt: new Date("2026-07-27T14:20:00.000Z"),
      }),
    ).rejects.toThrow("TRANSITION_ACTOR_MISMATCH");

    await expectNoPartialWrites(nullActorRequestId, "pending_approval");
  });

  test("rolls back the request and transition when audit insertion fails after both writes", async () => {
    const database = drizzle(appPool, { schema });
    await owner.query(`
      CREATE FUNCTION reject_workflow_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.entity_id = '${auditFailureRequestId}'::uuid THEN
          RAISE EXCEPTION 'forced workflow audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_workflow_audit
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION reject_workflow_audit();
    `);

    try {
      await expect(
        transitionRequest(database, authorization, {
          requestId: auditFailureRequestId,
          from: "pending_approval",
          to: "approved",
          actorUserId: actorId,
          note: "Must roll back",
          occurredAt: new Date("2026-07-27T14:21:00.000Z"),
        }),
      ).rejects.toThrow("forced workflow audit failure");

      await expectNoPartialWrites(
        auditFailureRequestId,
        "pending_approval",
      );
    } finally {
      await owner.query(`
        DROP TRIGGER reject_workflow_audit ON audit_log;
        DROP FUNCTION reject_workflow_audit();
      `);
    }
  });

  test("serializes simultaneous competing decisions so exactly one commits", async () => {
    const approvedDecisionAt = new Date("2026-07-27T14:22:00.000Z");
    const rejectedDecisionAt = new Date("2026-07-27T14:23:00.000Z");
    let blockerConnection: pg.Client | undefined;
    let approvedConnection: pg.Client | undefined;
    let rejectedConnection: pg.Client | undefined;
    let observerConnection: pg.Client | undefined;
    let blockerActive = false;
    let outcomesPromise:
      | Promise<PromiseSettledResult<void>[]>
      | undefined;

    try {
      blockerConnection = await connectNamedApp(
        transitionBlockerApplication,
      );
      approvedConnection = await connectNamedApp(
        approvedTransitionApplication,
      );
      rejectedConnection = await connectNamedApp(
        rejectedTransitionApplication,
      );
      observerConnection = await connectNamedApp(
        transitionObserverApplication,
      );
      const approvedDatabase = drizzle(approvedConnection, { schema });
      const rejectedDatabase = drizzle(rejectedConnection, { schema });

      await blockerConnection.query("BEGIN");
      blockerActive = true;
      await blockerConnection.query(
        `SELECT id
         FROM license_request
         WHERE id = $1
         FOR UPDATE`,
        [concurrentRequestId],
      );

      outcomesPromise = Promise.allSettled([
        transitionRequest(approvedDatabase, authorization, {
          requestId: concurrentRequestId,
          from: "pending_approval",
          to: "approved",
          actorUserId: actorId,
          note: "Concurrent approval",
          occurredAt: approvedDecisionAt,
        }),
        transitionRequest(rejectedDatabase, authorization, {
          requestId: concurrentRequestId,
          from: "pending_approval",
          to: "rejected",
          actorUserId: actorId,
          note: "Concurrent rejection",
          occurredAt: rejectedDecisionAt,
        }),
      ]);
      const waits = await waitForBothTransitionLocks(observerConnection, [
        approvedTransitionApplication,
        rejectedTransitionApplication,
      ]);
      expect(
        waits.map(
          ({
            application_name,
            has_ungranted_lock,
            wait_event_type,
          }) => ({
            application_name,
            has_ungranted_lock,
            wait_event_type,
          }),
        ),
      ).toEqual([
        {
          application_name: approvedTransitionApplication,
          has_ungranted_lock: true,
          wait_event_type: "Lock",
        },
        {
          application_name: rejectedTransitionApplication,
          has_ungranted_lock: true,
          wait_event_type: "Lock",
        },
      ]);

      await blockerConnection.query("ROLLBACK");
      blockerActive = false;
      const outcomes = await outcomesPromise;
      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter(
        (outcome) => outcome.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const evidence = await owner.query(
        `SELECT
           request.state,
           transition.from_state,
           transition.to_state,
           transition.actor_user_id,
           transition.note AS transition_note,
           transition.occurred_at AS transition_occurred_at,
           audit.action,
           audit.company_id,
           audit.before,
           audit.after,
           audit.occurred_at AS audit_occurred_at
         FROM license_request AS request
         INNER JOIN request_transition AS transition
           ON transition.request_id = request.id
         INNER JOIN audit_log AS audit
           ON audit.entity_id = request.id
         WHERE request.id = $1`,
        [concurrentRequestId],
      );
      expect(evidence.rows).toHaveLength(1);
      const [committed] = evidence.rows;
      expect(["approved", "rejected"]).toContain(committed.state);
      const expected =
        committed.state === "approved"
          ? {
              note: "Concurrent approval",
              occurredAt: approvedDecisionAt,
            }
          : {
              note: "Concurrent rejection",
              occurredAt: rejectedDecisionAt,
            };
      expect(committed).toEqual({
        state: committed.state,
        from_state: "pending_approval",
        to_state: committed.state,
        actor_user_id: actorId,
        transition_note: expected.note,
        transition_occurred_at: expected.occurredAt,
        action: `request.${committed.state}`,
        company_id: companyA,
        before: { state: "pending_approval" },
        after: { state: committed.state },
        audit_occurred_at: expected.occurredAt,
      });

      const rejection = rejected[0];
      expect(rejection?.status).toBe("rejected");
      if (rejection?.status !== "rejected") {
        throw new Error("expected one rejected transition");
      }
      expect(rejection.reason).toBeInstanceOf(Error);
      expect((rejection.reason as Error).message).toBe(
        `REQUEST_STATE_CONFLICT:${concurrentRequestId}:pending_approval:${committed.state}`,
      );
    } finally {
      if (blockerActive && blockerConnection) {
        await blockerConnection.query("ROLLBACK").catch(() => undefined);
      }
      if (outcomesPromise) {
        await outcomesPromise;
      }
      await Promise.allSettled([
        ...(blockerConnection ? [blockerConnection.end()] : []),
        ...(approvedConnection ? [approvedConnection.end()] : []),
        ...(rejectedConnection ? [rejectedConnection.end()] : []),
        ...(observerConnection ? [observerConnection.end()] : []),
      ]);
    }
  });

  test("fails loudly and writes nothing when the locked update affects no row", async () => {
    const database = drizzle(appPool, { schema });
    await owner.query(`
      CREATE FUNCTION skip_workflow_request_update() RETURNS trigger AS $$
      BEGIN
        IF OLD.id = '${skippedUpdateRequestId}'::uuid THEN
          RETURN NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER skip_workflow_request_update
        BEFORE UPDATE ON license_request
        FOR EACH ROW EXECUTE FUNCTION skip_workflow_request_update();
    `);

    try {
      await expect(
        transitionRequest(database, authorization, {
          requestId: skippedUpdateRequestId,
          from: "pending_approval",
          to: "approved",
          actorUserId: actorId,
          note: "Skipped by test trigger",
          occurredAt: new Date("2026-07-27T14:24:00.000Z"),
        }),
      ).rejects.toThrow(
        `REQUEST_UPDATE_CONFLICT:${skippedUpdateRequestId}`,
      );

      await expectNoPartialWrites(
        skippedUpdateRequestId,
        "pending_approval",
      );
    } finally {
      await owner.query(`
        DROP TRIGGER skip_workflow_request_update ON license_request;
        DROP FUNCTION skip_workflow_request_update();
      `);
    }
  });

  test("isolates unexpected enum drift from the canonical shared fixture", async () => {
    const driftFixture = await createPostgresFixture();
    let driftOwner: pg.Client | undefined;
    let driftPool: pg.Pool | undefined;

    try {
      await driftFixture.migrate();
      driftOwner = await driftFixture.connectAsOwner();
      driftPool = new pg.Pool({
        connectionString: driftFixture.appUrl,
      });
      await seedIsolatedDriftRequest(driftOwner);
      expect(await requestStateLabels(driftOwner)).toEqual(
        Object.keys(REQUEST_TRANSITIONS),
      );

      await driftOwner.query(
        "ALTER TYPE license_request_state_enum ADD VALUE 'unexpected_state'",
      );
      await driftOwner.query(
        `UPDATE license_request
         SET state = 'unexpected_state'
         WHERE id = $1`,
        [invalidStateRequestId],
      );

      const driftDatabase = drizzle(driftPool, { schema });
      const driftAuthorization =
        await createAuthorizationRepository(driftDatabase).load({
          subject: "workflow-approver",
        });
      if (!driftAuthorization) {
        throw new Error("isolated drift authorization was not loaded");
      }

      await expect(
        transitionRequest(driftDatabase, driftAuthorization, {
          requestId: invalidStateRequestId,
          from: "pending_approval",
          to: "approved",
          actorUserId: actorId,
          note: null,
          occurredAt: new Date("2026-07-27T14:25:00.000Z"),
        }),
      ).rejects.toThrow(
        `INVALID_REQUEST_STATE:${invalidStateRequestId}`,
      );

      const unchanged = await driftOwner.query(
        `SELECT
           (SELECT state FROM license_request WHERE id = $1) AS state,
           (SELECT count(*)::int FROM request_transition
            WHERE request_id = $1) AS transition_count,
           (SELECT count(*)::int FROM audit_log
            WHERE entity_id = $1) AS audit_count`,
        [invalidStateRequestId],
      );
      expect(unchanged.rows).toEqual([
        {
          state: "unexpected_state",
          transition_count: 0,
          audit_count: 0,
        },
      ]);
    } finally {
      await Promise.allSettled([
        ...(driftPool ? [driftPool.end()] : []),
        ...(driftOwner ? [driftOwner.end()] : []),
      ]);
      await driftFixture.stop();
    }

    expect(await requestStateLabels(owner)).toEqual(
      Object.keys(REQUEST_TRANSITIONS),
    );
  });
});

async function expectNoPartialWrites(
  requestId: string,
  expectedState: string,
): Promise<void> {
  const result = await owner.query(
    `SELECT
       (SELECT state FROM license_request WHERE id = $1) AS state,
       (SELECT count(*)::int FROM request_transition
        WHERE request_id = $1) AS transition_count,
       (SELECT count(*)::int FROM audit_log
        WHERE entity_id = $1) AS audit_count`,
    [requestId],
  );
  expect(result.rows).toEqual([
    {
      state: expectedState,
      transition_count: 0,
      audit_count: 0,
    },
  ]);
}

async function requestStateLabels(
  databaseOwner: pg.Client,
): Promise<string[]> {
  const result = await databaseOwner.query(
    `SELECT enumlabel
     FROM pg_enum
     INNER JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
     WHERE pg_type.typname = 'license_request_state_enum'
     ORDER BY pg_enum.enumsortorder`,
  );
  return result.rows.map(({ enumlabel }) => enumlabel);
}

async function seedIsolatedDriftRequest(
  databaseOwner: pg.Client,
): Promise<void> {
  await databaseOwner.query(
    `INSERT INTO user_account
       (id, email, idp_subject, ui_language, status, created_at)
     VALUES
       ($1, 'workflow.approver@corporativo.example', 'workflow-approver',
        'es', 'active', '2026-07-27T12:00:00.000Z')`,
    [actorId],
  );
  await databaseOwner.query(
    `INSERT INTO company
       (id, code, name, type, status, budget_monthly_usd,
        statement_language, created_at, created_by)
     VALUES
       ($1, 'WFA', 'Workflow Company A', 'internal', 'active', 1000,
        'es', '2026-07-27T12:00:00.000Z', $2)`,
    [companyA, actorId],
  );
  await databaseOwner.query(
    `INSERT INTO person
       (id, email, full_name, company_id, status, created_at, created_by)
     VALUES
       ($1, 'person.a@corporativo.example', 'Person A', $2, 'active',
        '2026-07-27T12:00:00.000Z', $3)`,
    [personA, companyA, actorId],
  );
  await databaseOwner.query(
    `INSERT INTO company_role_assignment
       (id, user_account_id, company_id, role, unique_grant,
        created_at, created_by)
     VALUES
       ($1, $2, $3, 'approver', 'workflow-approver-company-a',
        '2026-07-27T12:00:00.000Z', $2)`,
    [grantId, actorId, companyA],
  );
  await databaseOwner.query(
    `INSERT INTO vendor
       (id, name, connector_type, provisioning_protocol, can_provision,
        can_deprovision, has_usage_data, has_cost_data, identity_matching,
        status, created_at, created_by)
     VALUES
       ($1, 'Workflow Vendor', 'orchestration', 'none', false, false,
        false, false, 'email', 'active',
        '2026-07-27T12:00:00.000Z', $2)`,
    [vendorId, actorId],
  );
  await databaseOwner.query(
    `INSERT INTO vendor_account
       (id, vendor_id, name, mode, low_pool_floor, status, created_at,
        created_by)
     VALUES
       ($1, $2, 'Workflow Account', 'orchestration', 1, 'active',
        '2026-07-27T12:00:00.000Z', $3)`,
    [vendorAccountId, vendorId, actorId],
  );
  await databaseOwner.query(
    `INSERT INTO license_type
       (id, vendor_id, name, unit, status, created_at, created_by)
     VALUES
       ($1, $2, 'Workflow Seat', 'seat', 'active',
        '2026-07-27T12:00:00.000Z', $3)`,
    [licenseTypeId, vendorId, actorId],
  );
  await databaseOwner.query(
    `INSERT INTO license_request
       (id, request_no, person_id, company_id, vendor_account_id,
        license_type_id, state, justification, requested_by, created_at,
        created_by)
     VALUES
       ($1, 'WF-DRIFT', $2, $3, $4, $5, 'pending_approval',
        'Unexpected database state', $6,
        '2026-07-27T12:00:00.000Z', $6)`,
    [
      invalidStateRequestId,
      personA,
      companyA,
      vendorAccountId,
      licenseTypeId,
      actorId,
    ],
  );
}

async function connectNamedApp(
  applicationName: string,
): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: fixture.appUrl,
    application_name: applicationName,
  });
  await client.connect();
  return client;
}

type LockWaitObservation = {
  readonly application_name: string;
  readonly blocking_pids: number[];
  readonly has_ungranted_lock: boolean;
  readonly state: string | null;
  readonly wait_event: string | null;
  readonly wait_event_type: string | null;
};

async function waitForBothTransitionLocks(
  observer: pg.Client,
  applicationNames: readonly [string, string],
): Promise<readonly LockWaitObservation[]> {
  let latest: readonly LockWaitObservation[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const observed = await observer.query<LockWaitObservation>(
      `SELECT
         activity.application_name,
         activity.state,
         activity.wait_event_type,
         activity.wait_event,
         pg_blocking_pids(activity.pid) AS blocking_pids,
         EXISTS (
           SELECT 1
           FROM pg_locks
           WHERE pg_locks.pid = activity.pid
             AND NOT pg_locks.granted
         ) AS has_ungranted_lock
       FROM pg_stat_activity AS activity
       WHERE activity.datname = current_database()
         AND activity.application_name = ANY($1::text[])
       ORDER BY activity.application_name`,
      [applicationNames],
    );
    latest = observed.rows;
    if (
      applicationNames.every((applicationName) =>
        latest.some(
          (row) =>
            row.application_name === applicationName &&
            row.wait_event_type === "Lock" &&
            row.has_ungranted_lock &&
            row.blocking_pids.length > 0,
        ),
      )
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `CONCURRENCY_OVERLAP_NOT_OBSERVED:${JSON.stringify(latest)}`,
  );
}
