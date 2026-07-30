import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createConnectorDispatcher,
  type VendorConnector,
} from "@smp/connectors";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import { createAuthorizationRepository } from "../identity-access/authorization";
import { createCrossOrgMoveService } from "./cross-org-move";

const id = (suffix: string) => `22100000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"), company: id("2"), person: id("3"), vendor: id("4"),
  source: id("5"), target: id("6"), licenseType: id("7"),
  request: id("8"), assignment: id("9"),
  companyOther: id("10"), personOrchestration: id("11"),
  sourceOrchestration: id("12"), targetAutomated: id("13"),
  requestOrchestration: id("14"), assignmentOrchestration: id("15"),
  personCrossTenant: id("16"), requestCrossTenant: id("17"),
  assignmentCrossTenant: id("18"),
  adminOther: id("19"),
};

let fixture: PostgresFixture | undefined;
let owner: pg.Client;
let appPool: pg.Pool;
let applicationUrl: string;
let authorization: NonNullable<
  Awaited<ReturnType<ReturnType<typeof createAuthorizationRepository>["load"]>>
>;
let service: ReturnType<typeof createCrossOrgMoveService>;
let serviceClosed = false;
const processingAt = new Date("2026-07-30T15:00:00.000Z");

beforeAll(async () => {
  const mutationAppUrl = process.env.US022_MUTATION_DATABASE_URL;
  const mutationOwnerUrl = process.env.US022_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("US-022 mutation harness requires both database URLs");
    }
    applicationUrl = mutationAppUrl;
    owner = new pg.Client({ connectionString: mutationOwnerUrl });
    await owner.connect();
  } else {
    fixture = await createPostgresFixture();
    await fixture.migrate();
    applicationUrl = fixture.appUrl;
    owner = await fixture.connectAsOwner();
  }
  await owner.query(
    `TRUNCATE TABLE audit_log, provisioning_action, license_request,
       license_assignment, license_type, vendor_account, vendor, person,
       company, user_account RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'move@pool.test','move-admin','group_admin','es','active',now())`,
    [ids.admin],
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'other-admin@pool.test','move-admin-other',
             'group_admin','es','active',now())`,
    [ids.adminOther],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ($1,'Move company','MOVE','internal','active','es',now(),$2)`,
    [ids.company, ids.admin],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ($1,'Other company','OTHER','external','active','es',now(),$2)`,
    [ids.companyOther, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES
       ($1,'holder@pool.test','Move Holder',$4,'active',now(),$6),
       ($2,'manual@pool.test','Manual Holder',$4,'active',now(),$6),
       ($3,'cross@pool.test','Cross Tenant Holder',$5,'active',now(),$6)`,
    [
      ids.person,
      ids.personOrchestration,
      ids.personCrossTenant,
      ids.company,
      ids.companyOther,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Move vendor','api','rest',true,true,false,false,'email','active',now(),$2)`,
    [ids.vendor, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$3,'Move source','automated',1,'active',now(),$4),
            ($2,$3,'Move target','orchestration',1,'active',now(),$4),
            ($5,$3,'Manual source','orchestration',1,'active',now(),$4),
            ($6,$3,'Automated target','automated',1,'active',now(),$4)`,
    [
      ids.source,
      ids.target,
      ids.vendor,
      ids.admin,
      ids.sourceOrchestration,
      ids.targetAutomated,
    ],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Move seat','seat','active',now(),$3)`,
    [ids.licenseType, ids.vendor, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,created_at,created_by)
     VALUES
       ($1,'MOVE-1',$4,$6,$7,$9,'active','cross-org move',now(),$10),
       ($2,'MOVE-2',$5,$6,$8,$9,'active','cross-org move',now(),$10),
       ($3,'MOVE-X',$11,$6,$7,$9,'active','cross-tenant fixture',now(),$10)`,
    [
      ids.request,
      ids.requestOrchestration,
      ids.requestCrossTenant,
      ids.person,
      ids.personOrchestration,
      ids.company,
      ids.source,
      ids.sourceOrchestration,
      ids.licenseType,
      ids.admin,
      ids.personCrossTenant,
    ],
  );
  await owner.query(
    `INSERT INTO license_assignment
       (id,person_id,company_id,vendor_account_id,license_type_id,started_on,
        source_request_id,source_kind,created_at,created_by)
     VALUES
       ($1,$4,$6,$7,$9,'2026-01-01',$10,'request',now(),$11),
       ($2,$5,$6,$8,$9,'2026-01-01',$12,'request',now(),$11),
       ($3,$13,$6,$7,$9,'2026-01-01',$14,'request',now(),$11)`,
    [
      ids.assignment,
      ids.assignmentOrchestration,
      ids.assignmentCrossTenant,
      ids.person,
      ids.personOrchestration,
      ids.company,
      ids.source,
      ids.sourceOrchestration,
      ids.licenseType,
      ids.request,
      ids.admin,
      ids.requestOrchestration,
      ids.personCrossTenant,
      ids.requestCrossTenant,
    ],
  );
  appPool = new pg.Pool({ connectionString: applicationUrl });
  const authRepository = createAuthorizationRepository(drizzle(appPool, { schema }));
  const loaded = await authRepository.load({ subject: "move-admin" });
  if (!loaded) throw new Error("move authorization fixture failed");
  authorization = loaded;
  const connector: VendorConnector = {
    capabilities: () => new Set(["provision", "deprovision"]),
    deprovision: async () => ({
      ok: true,
      raw: { accepted: true },
      value: { vendorRef: null },
    }),
    provision: async () => ({
      ok: true,
      raw: { accepted: true },
      value: { vendorRef: null },
    }),
    syncActivity: async () => ({
      code: "unsupported", checklistSteps: [], ok: false,
    }),
    syncCost: async () => ({
      code: "unsupported", checklistSteps: [], ok: false,
    }),
    syncMembers: async () => ({
      code: "unsupported", checklistSteps: [], ok: false,
    }),
  };
  const dispatcher = createConnectorDispatcher();
  dispatcher.register("rest", connector);
  service = createCrossOrgMoveService(applicationUrl, {
    dispatcher,
    now: () => processingAt,
  });
}, 120_000);

afterAll(async () => {
  await Promise.all([
    service && !serviceClosed ? service.close() : Promise.resolve(),
    appPool?.end(),
    owner?.end(),
  ]);
  await fixture?.stop();
});

describe("US-022 callable cross-organization move workflow", () => {
  it("rejects an in-place vendor-account mutation", async () => {
    await expect(service.move(authorization, {
      assignmentId: ids.assignment,
      clientRequestId: "move-same",
      effectiveOn: "2026-07-28",
      targetVendorAccountId: ids.source,
    })).rejects.toThrow("CROSS_ORG_MOVE_REQUIRES_DISTINCT_ACCOUNTS");
  });

  it("rejects unauthorized and malformed commands before the database call", async () => {
    await expect(
      service.move(
        { ...authorization, globalRole: "central_finance" },
        {
          assignmentId: ids.assignment,
          clientRequestId: "move-forbidden",
          effectiveOn: "2026-07-28",
          targetVendorAccountId: ids.target,
        },
      ),
    ).rejects.toThrow("CROSS_ORG_MOVE_FORBIDDEN");
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignmentCrossTenant,
        clientRequestId: "move-cross-tenant",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.target,
      }),
    ).rejects.toThrow("MOVE_REQUEST_MISMATCH");
    await expect(
      owner.query(
        `SELECT
           (SELECT state FROM license_request WHERE id = $1) AS state,
           (SELECT count(*)::int FROM request_transition
            WHERE request_id = $1) AS transitions,
           (SELECT count(*)::int FROM provisioning_action
            WHERE request_id = $1) AS actions,
           (SELECT ended_on FROM license_assignment WHERE id = $2) AS ended_on`,
        [ids.requestCrossTenant, ids.assignmentCrossTenant],
      ),
    ).resolves.toMatchObject({
      rows: [{
        actions: 0,
        ended_on: null,
        state: "active",
        transitions: 0,
      }],
    });
    const emptyRequestIdError = await service.move(authorization, {
        assignmentId: ids.assignment,
        clientRequestId: "   ",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.target,
      }).catch((error: unknown) => error);
    expect(emptyRequestIdError).toBeInstanceOf(TypeError);
    expect(emptyRequestIdError).toHaveProperty(
      "message",
      "clientRequestId is required",
    );
    for (const effectiveOn of [
      "2026-7-28",
      "2026-02-30",
      "x2026-07-28",
      "2026-07-28suffix",
    ]) {
      await expect(
        service.move(authorization, {
          assignmentId: ids.assignment,
          clientRequestId: `bad-date-${effectiveOn}`,
          effectiveOn,
          targetVendorAccountId: ids.target,
        }),
      ).rejects.toThrow("effectiveOn must be an ISO date");
    }
    const invalidClockService = createCrossOrgMoveService(applicationUrl, {
      now: () => new Date(Number.NaN),
    });
    try {
      await expect(
        invalidClockService.move(authorization, {
          assignmentId: ids.assignment,
          clientRequestId: "invalid-clock",
          effectiveOn: "2026-07-28",
          targetVendorAccountId: ids.target,
        }),
      ).rejects.toThrow("processing clock returned an invalid instant");
    } finally {
      await invalidClockService.close();
    }
    const defaultClockService = createCrossOrgMoveService(applicationUrl);
    try {
      await expect(
        defaultClockService.move(authorization, {
          assignmentId: id("997"),
          clientRequestId: "default-clock",
          effectiveOn: "2026-07-28",
          targetVendorAccountId: ids.target,
        }),
      ).rejects.toThrow("MOVE_REQUEST_MISMATCH");
    } finally {
      await defaultClockService.close();
    }
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignment,
        clientRequestId: "missing-target",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: id("999"),
      }),
    ).rejects.toThrow("MOVE_TARGET_INCOMPATIBLE");
  });

  it("atomically enqueues automated removal and orchestration provisioning without changing the register, and replays", async () => {
    const input = {
      assignmentId: ids.assignment,
      clientRequestId: "move-atomic-1",
      effectiveOn: "2026-07-28",
      targetVendorAccountId: ids.target,
    };
    const outcomes = await Promise.all([
      service.move(authorization, input),
      service.move(authorization, input),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      "executed",
      "replayed",
    ]);
    expect(outcomes[1].sourceOperation).toEqual(outcomes[0].sourceOperation);
    expect(outcomes[1].destinationOperation).toEqual(
      outcomes[0].destinationOperation,
    );
    for (const changed of [
      { effectiveOn: "2026-07-29" },
      { targetVendorAccountId: ids.targetAutomated },
    ]) {
      await expect(
        service.move(authorization, { ...input, ...changed }),
      ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    }
    await expect(
      service.move(
        {
          ...authorization,
          userAccountId: ids.adminOther,
          userId: ids.adminOther,
        },
        input,
      ),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");

    const evidence = await owner.query(
      `SELECT
         (SELECT jsonb_agg(jsonb_build_object(
           'vendorAccountId', vendor_account_id,
           'endedOn', ended_on,
           'endReason', end_reason,
           'note', note,
           'startedOn', started_on
         ) ORDER BY started_on, id)
          FROM license_assignment WHERE person_id = $1) AS assignments,
         (SELECT jsonb_agg(jsonb_build_object(
           'failureReason', action.failure_reason,
           'checklistSteps', action.raw_request->'checklistSteps',
           'context', action.raw_request->'context',
           'instruction', action.raw_request->'instruction',
           'kind', action.kind,
           'mode', action.mode,
           'operation', action.raw_request->>'operation',
           'rawResponse', action.raw_response,
           'requestVendorAccountId', request.vendor_account_id,
           'resolvedAt', action.resolved_at,
           'sentAt', action.sent_at,
           'status', action.status,
           'vendorRef', action.vendor_ref,
           'vendorAccountId', action.vendor_account_id
         ) ORDER BY CASE raw_request->>'operation'
                      WHEN 'deprovision' THEN 1 ELSE 2 END)
          FROM provisioning_action action
          JOIN license_request request ON request.id = action.request_id
          WHERE action.raw_request #>> '{context,clientRequestId}' =
            'move-atomic-1') AS actions,
         (SELECT jsonb_agg(jsonb_build_object(
           'requestId', transition.request_id,
           'from', transition.from_state,
           'to', transition.to_state,
           'actorUserId', transition.actor_user_id,
           'note', transition.note
         ) ORDER BY CASE transition.from_state
              WHEN 'active' THEN 1
              WHEN 'submitted' THEN 2
              WHEN 'pending_approval' THEN 3
              WHEN 'approved' THEN 4
              ELSE 5
            END)
          FROM request_transition transition
          WHERE transition.request_id IN (
            $2, (SELECT id FROM license_request
                 WHERE vendor_account_id = $3
                   AND justification = 'Cross-organization move')
          )) AS transitions,
         (SELECT jsonb_object_agg(vendor_account_id::text, state)
          FROM license_request
          WHERE id = $2 OR (
            vendor_account_id = $3
            AND justification = 'Cross-organization move'
          )) AS request_states,
         (SELECT count(*)::int FROM audit_log
          WHERE entity_type = 'CrossOrgMove' AND entity_id = $4) AS audits,
         (SELECT jsonb_build_object(
            'action', action,
            'before', before,
            'after', after
          )
          FROM audit_log
          WHERE entity_type = 'CrossOrgMove'
            AND entity_id = $4) AS move_audit,
         (SELECT bool_and(occurred_at = $5::timestamptz)
          FROM audit_log
          WHERE entity_type = 'CrossOrgMove'
            AND entity_id = $4) AS move_audit_timestamp_current,
         (SELECT bool_and(created_at = $5::timestamptz)
          FROM provisioning_action
          WHERE raw_request #>> '{context,clientRequestId}' =
            'move-atomic-1') AS action_timestamps_current,
         (SELECT bool_and(occurred_at = $5::timestamptz)
          FROM request_transition
          WHERE request_id IN (
            $2, (SELECT id FROM license_request
                 WHERE vendor_account_id = $3
                   AND justification = 'Cross-organization move')
          )) AS transition_timestamps_current,
         (SELECT jsonb_agg(jsonb_build_object(
           'action', audit.action,
           'actorUserId', audit.actor_user_id,
           'before', audit.before,
           'after', audit.after
         ) ORDER BY CASE audit.action
              WHEN 'request.offboarding' THEN 1
              WHEN 'request.pending_approval' THEN 2
              WHEN 'request.approved' THEN 3
              WHEN 'request.provisioning' THEN 4
              ELSE 5
            END)
          FROM audit_log audit
          WHERE audit.entity_type = 'LicenseRequest'
            AND audit.entity_id IN (
              $2, (SELECT id FROM license_request
                   WHERE vendor_account_id = $3
                     AND justification = 'Cross-organization move')
            )) AS transition_audits`,
      [
        ids.person,
        ids.request,
        ids.target,
        ids.assignment,
        processingAt,
      ],
    );
    expect(evidence.rows[0]).toEqual({
      action_timestamps_current: true,
      actions: [
        {
          failureReason: null,
          checklistSteps: [],
          context: {
            assignmentIds: [ids.assignment],
            clientRequestId: "move-atomic-1",
            effectiveOn: "2026-07-28",
          },
          kind: "remove",
          instruction: {
            licenseTypeName: "Move seat",
            personEmail: "holder@pool.test",
            requestId: ids.request,
            vendorAccountId: ids.source,
          },
          mode: "automated",
          operation: "deprovision",
          rawResponse: null,
          requestVendorAccountId: ids.source,
          resolvedAt: null,
          sentAt: null,
          status: "pending",
          vendorRef: null,
          vendorAccountId: ids.source,
        },
        {
          failureReason: null,
          checklistSteps: [
            expect.objectContaining({
              messageKey: "connector.manual.open_vendor_console",
            }),
            expect.objectContaining({
              messageKey: "connector.manual.invite_person",
            }),
            expect.objectContaining({
              messageKey: "connector.manual.assign_license",
            }),
            expect.objectContaining({
              messageKey: "connector.manual.confirm_execution",
            }),
          ],
          context: {
            clientRequestId: "move-atomic-1",
            effectiveOn: "2026-07-28",
            sourceAssignmentId: ids.assignment,
          },
          kind: "checklist",
          instruction: {
            licenseTypeName: "Move seat",
            personEmail: "holder@pool.test",
            requestId: outcomes[0].destinationOperation.requestId,
            vendorAccountId: ids.target,
          },
          mode: "orchestration",
          operation: "provision",
          rawResponse: null,
          requestVendorAccountId: ids.target,
          resolvedAt: null,
          sentAt: null,
          status: "pending",
          vendorRef: null,
          vendorAccountId: ids.target,
        },
      ],
      assignments: [
        {
          endedOn: null,
          endReason: null,
          note: null,
          startedOn: "2026-01-01",
          vendorAccountId: ids.source,
        },
      ],
      audits: 1,
      move_audit: {
        action: "license_assignment.cross_org_move_enqueued",
        before: {
          requestId: ids.request,
          requestState: "active",
          vendorAccountId: ids.source,
        },
        after: {
          clientRequestId: "move-atomic-1",
          destinationOperationId:
            outcomes[0].destinationOperation.id,
          destinationRequestId:
            outcomes[0].destinationOperation.requestId,
          effectiveOn: "2026-07-28",
          sourceOperationId: outcomes[0].sourceOperation.id,
          sourceRequestId: ids.request,
          targetVendorAccountId: ids.target,
        },
      },
      move_audit_timestamp_current: true,
      request_states: {
        [ids.source]: "offboarding",
        [ids.target]: "provisioning",
      },
      transitions: [
        {
          actorUserId: ids.admin,
          from: "active",
          note: "Cross-organization move: enqueue source deprovision",
          requestId: ids.request,
          to: "offboarding",
        },
        {
          actorUserId: ids.admin,
          from: "submitted",
          note: "Cross-organization move submitted",
          requestId: outcomes[0].destinationOperation.requestId,
          to: "pending_approval",
        },
        {
          actorUserId: ids.admin,
          from: "pending_approval",
          note: "Cross-organization move approved",
          requestId: outcomes[0].destinationOperation.requestId,
          to: "approved",
        },
        {
          actorUserId: ids.admin,
          from: "approved",
          note: "Cross-organization move provisioning",
          requestId: outcomes[0].destinationOperation.requestId,
          to: "provisioning",
        },
      ],
      transition_timestamps_current: true,
      transition_audits: [
        {
          action: "request.offboarding",
          actorUserId: ids.admin,
          after: { state: "offboarding" },
          before: { state: "active" },
        },
        {
          action: "request.pending_approval",
          actorUserId: ids.admin,
          after: { state: "pending_approval" },
          before: { state: "submitted" },
        },
        {
          action: "request.approved",
          actorUserId: ids.admin,
          after: { state: "approved" },
          before: { state: "pending_approval" },
        },
        {
          action: "request.provisioning",
          actorUserId: ids.admin,
          after: { state: "provisioning" },
          before: { state: "approved" },
        },
      ],
    });
    expect(outcomes[0]).toEqual({
      destinationOperation: {
        id: expect.any(String),
        kind: "checklist",
        requestId: expect.any(String),
      },
      sourceOperation: {
        id: expect.any(String),
        kind: "remove",
        requestId: ids.request,
      },
      status: expect.stringMatching(/^(executed|replayed)$/),
    });
    await expect(
      service.move(authorization, {
        ...input,
        clientRequestId: "move-source-no-longer-active",
      }),
    ).rejects.toThrow("MOVE_REQUEST_NOT_ACTIVE");
  });

  it("derives orchestration removal and automated provisioning from the persisted account modes", async () => {
    const outcome = await service.move(authorization, {
      assignmentId: ids.assignmentOrchestration,
      clientRequestId: "move-mode-pair",
      effectiveOn: "2026-07-28",
      targetVendorAccountId: ids.targetAutomated,
    });
    expect(outcome).toEqual({
      destinationOperation: {
        id: expect.any(String),
        kind: "invite",
        requestId: expect.any(String),
      },
      sourceOperation: {
        id: expect.any(String),
        kind: "checklist",
        requestId: ids.requestOrchestration,
      },
      status: "executed",
    });
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignmentOrchestration,
        clientRequestId: "move-mode-pair",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.targetAutomated,
      }),
    ).resolves.toMatchObject({
      destinationOperation: { kind: "invite" },
      sourceOperation: { kind: "checklist" },
      status: "replayed",
    });
    const evidence = await owner.query(
      `SELECT action.kind, action.mode, action.status,
              action.raw_request->'checklistSteps' AS checklist_steps,
              action.vendor_ref, action.raw_response, action.sent_at,
              action.resolved_at
       FROM provisioning_action action
       WHERE action.id IN ($1, $2)
       ORDER BY action.raw_request->>'operation'`,
      [outcome.sourceOperation.id, outcome.destinationOperation.id],
    );
    expect(evidence.rows).toEqual([
      {
        checklist_steps: [
          expect.objectContaining({
            messageKey: "connector.manual.open_vendor_console",
          }),
          expect.objectContaining({
            messageKey: "connector.manual.remove_person",
          }),
          expect.objectContaining({
            messageKey: "connector.manual.revoke_license",
          }),
          expect.objectContaining({
            messageKey: "connector.manual.confirm_execution",
          }),
        ],
        kind: "checklist",
        mode: "orchestration",
        raw_response: null,
        resolved_at: null,
        sent_at: null,
        status: "pending",
        vendor_ref: null,
      },
      {
        checklist_steps: [],
        kind: "invite",
        mode: "automated",
        raw_response: null,
        resolved_at: null,
        sent_at: null,
        status: "pending",
        vendor_ref: null,
      },
    ]);
    await expect(
      owner.query(
        `SELECT id FROM license_assignment
         WHERE source_request_id = $1`,
        [outcome.destinationOperation.requestId],
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await owner.query(
      "UPDATE provisioning_action SET kind = 'invite' WHERE id = $1",
      [outcome.sourceOperation.id],
    );
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignmentOrchestration,
        clientRequestId: "move-mode-pair",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.targetAutomated,
      }),
    ).rejects.toThrow("CROSS_ORG_MOVE_REPLAY_INTEGRITY");
    await owner.query(
      "UPDATE provisioning_action SET kind = 'checklist' WHERE id = $1",
      [outcome.sourceOperation.id],
    );
    await owner.query(
      "UPDATE provisioning_action SET request_id = $2 WHERE id = $1",
      [
        outcome.sourceOperation.id,
        outcome.destinationOperation.requestId,
      ],
    );
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignmentOrchestration,
        clientRequestId: "move-mode-pair",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.targetAutomated,
      }),
    ).rejects.toThrow("CROSS_ORG_MOVE_REPLAY_INTEGRITY");
    await owner.query(
      "UPDATE provisioning_action SET request_id = $2 WHERE id = $1",
      [outcome.sourceOperation.id, ids.requestOrchestration],
    );
    await owner.query(
      "UPDATE provisioning_action SET kind = 'remove' WHERE id = $1",
      [outcome.destinationOperation.id],
    );
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignmentOrchestration,
        clientRequestId: "move-mode-pair",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.targetAutomated,
      }),
    ).rejects.toThrow("CROSS_ORG_MOVE_REPLAY_INTEGRITY");
    await owner.query(
      "UPDATE provisioning_action SET kind = 'invite' WHERE id = $1",
      [outcome.destinationOperation.id],
    );
    await owner.query(
      "UPDATE provisioning_action SET request_id = $2 WHERE id = $1",
      [outcome.destinationOperation.id, ids.requestOrchestration],
    );
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignmentOrchestration,
        clientRequestId: "move-mode-pair",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.targetAutomated,
      }),
    ).rejects.toThrow("CROSS_ORG_MOVE_REPLAY_INTEGRITY");
    await owner.query(
      "UPDATE provisioning_action SET request_id = $2 WHERE id = $1",
      [
        outcome.destinationOperation.id,
        outcome.destinationOperation.requestId,
      ],
    );
    const removedSource = await owner.query(
      `DELETE FROM provisioning_action
        WHERE id = $1
        RETURNING id, request_id, vendor_account_id, kind, mode, status,
                  raw_request, created_at`,
      [outcome.sourceOperation.id],
    );
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignmentOrchestration,
        clientRequestId: "move-mode-pair",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.targetAutomated,
      }),
    ).rejects.toThrow("CROSS_ORG_MOVE_REPLAY_INTEGRITY");
    await owner.query(
      `INSERT INTO provisioning_action
         (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
       SELECT id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at
       FROM jsonb_populate_record(
         NULL::provisioning_action,
         $1::jsonb
       )`,
      [JSON.stringify(removedSource.rows[0])],
    );
    await owner.query(
      "DELETE FROM provisioning_action WHERE id = $1",
      [outcome.destinationOperation.id],
    );
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignmentOrchestration,
        clientRequestId: "move-mode-pair",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.targetAutomated,
      }),
    ).rejects.toThrow("CROSS_ORG_MOVE_REPLAY_INTEGRITY");
  });

  it("closes its database resources", async () => {
    await service.close();
    serviceClosed = true;
    await expect(
      service.move(authorization, {
        assignmentId: ids.assignment,
        clientRequestId: "after-close",
        effectiveOn: "2026-07-28",
        targetVendorAccountId: ids.target,
      }),
    ).rejects.toThrow();
  });
});
