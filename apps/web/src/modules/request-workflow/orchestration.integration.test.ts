import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import type { LedgerAuthorization } from "../identity-access/authorization";
import {
  createChecklistActionService,
  createProductionChecklistActionService,
} from "./actions/checklist-action-transaction";
import { createMemberSyncChecklistObservationPort } from "./member-sync-checklist-observation";
import {
  createOrchestrationService,
  type OrchestrationService,
} from "./orchestration";

type RouteOutcome = Awaited<
  ReturnType<OrchestrationService["routeApprovedRequest"]>
>;
type RoutedAction = Exclude<
  RouteOutcome,
  { readonly status: "blocked_no_seat" }
>;
type SeatAvailableService = Omit<
  OrchestrationService,
  "routeApprovedRequest"
> & {
  routeApprovedRequest(
    ...args: Parameters<OrchestrationService["routeApprovedRequest"]>
  ): Promise<RoutedAction>;
};

const id = (suffix: string) =>
  `32000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"),
  company: id("2"),
  otherCompany: id("3"),
  person: id("4"),
  vendor: id("5"),
  account: id("6"),
  licenseType: id("7"),
  request: id("8"),
  action: id("9"),
  failureRequest: id("10"),
  failureAction: id("11"),
  rule: id("12"),
};

const authorization: LedgerAuthorization = {
  companyGrants: [],
  companyIds: [],
  employeeCompanyId: null,
  globalRole: "group_admin",
  idpSubject: "checklist-admin",
  roles: ["group_admin"],
  userAccountId: ids.admin,
  userId: ids.admin,
};
const occurredAt = new Date("2026-07-28T15:00:00.000Z");
const mailpitSmtpUrl = process.env.MAILPIT_TEST_SMTP_URL;

let fixture: PostgresFixture;
let owner: pg.Client;
let service: SeatAvailableService;
let actionPool: pg.Pool;
let actionService: ReturnType<typeof createChecklistActionService>;
let applicationUrl: string;

beforeAll(async () => {
  const mutationAppUrl =
    process.env.US042_MUTATION_DATABASE_URL ??
    process.env.US020_MUTATION_DATABASE_URL ??
    process.env.US016_MUTATION_DATABASE_URL;
  const mutationOwnerUrl =
    process.env.US042_MUTATION_DATABASE_ADMIN_URL ??
    process.env.US020_MUTATION_DATABASE_ADMIN_URL ??
    process.env.US016_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("orchestration mutation harness requires both database URLs");
    }
    applicationUrl = mutationAppUrl;
    owner = new pg.Client({ connectionString: mutationOwnerUrl });
    await owner.connect();
  } else {
    fixture = await createPostgresFixture();
    await fixture.migrate();
    owner = await fixture.connectAsOwner();
    applicationUrl = fixture.appUrl;
  }
  service = createOrchestrationService(applicationUrl, {
    now: () => occurredAt,
  }) as SeatAvailableService;
  actionPool = new pg.Pool({ connectionString: applicationUrl });
  actionService = createChecklistActionService(
    drizzle(actionPool, { schema }),
    {
      loadAuthorization: async () => authorization,
      now: () => occurredAt,
    },
  );
}, 120_000);

beforeEach(async () => {
  await owner.query(
    `TRUNCATE TABLE lifecycle_notification_delivery, lifecycle_notification,
       alert_notification_delivery, alert_event, audit_log,
       request_transition, provisioning_action, license_request,
       license_assignment, alert_rule, license_type, vendor_account, vendor,
       person, company, user_account RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'admin@checklist.test','checklist-admin','group_admin','es',
             'active',$2)`,
    [ids.admin, occurredAt],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES
       ($1,'Checklist tenant','CHECK','internal','active','es',$3,$4),
       ($2,'Other tenant','OTHER','external','active','es',$3,$4)`,
    [ids.company, ids.otherCompany, occurredAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ($1,'person@example.com','Checklist Person',$2,'active',$3,$4)`,
    [ids.person, ids.company, occurredAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,
        can_deprovision,has_usage_data,has_cost_data,identity_matching,status,
        created_at,created_by)
     VALUES ($1,'Generic manual vendor','orchestration','none',false,false,
             false,false,'email','active',$2,$3)`,
    [ids.vendor, occurredAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Manual org','orchestration',1,'active',$3,$4)`,
    [ids.account, ids.vendor, occurredAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Generic seat','seat','active',$3,$4)`,
    [ids.licenseType, ids.vendor, occurredAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account_capacity
       (vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by)
     VALUES ($1,$2,10,'2026-01-01',$3,$4)`,
    [ids.account, ids.licenseType, occurredAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,requested_by,created_at,created_by)
     VALUES
       ($1,'REQ-CHECK-1',$3,$4,$5,$6,'approved','manual route',$8,$7,$8),
       ($2,'REQ-CHECK-2',$3,$4,$5,$6,'provisioning','manual failure',$8,$7,$8)`,
    [
      ids.request,
      ids.failureRequest,
      ids.person,
      ids.company,
      ids.account,
      ids.licenseType,
      occurredAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO alert_rule
       (id,type,scope_kind,company_id,threshold,channel,enabled,created_at,
        created_by)
     VALUES ($1,'provisioning_failure','company',$2,'{}','email',true,$3,$4)`,
    [ids.rule, ids.company, occurredAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO provisioning_action
       (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
     VALUES
       ($1,$2,$3,'checklist','orchestration','pending',
        $5,
        $4)`,
    [
      ids.failureAction,
      ids.failureRequest,
      ids.account,
      occurredAt,
      {
        checklistSteps: [{
          messageKey: "connector.manual.invite_person",
          params: {
            licenseTypeName: "Generic seat",
            personEmail: "person@example.com",
          },
          targets: {
            licenseId: ids.licenseType,
            personId: ids.person,
            requestId: ids.failureRequest,
            vendorAccountId: ids.account,
          },
        }],
        context: { companyId: ids.company, requestId: ids.failureRequest },
        instruction: {
          licenseTypeName: "Generic seat",
          personEmail: "person@example.com",
          requestId: ids.failureRequest,
          vendorAccountId: ids.account,
        },
        operation: "provision",
        protocol: "none",
        version: 1,
      },
    ],
  );
});

afterAll(async () => {
  await service?.close();
  await actionPool?.end();
  await owner?.end();
  await fixture?.stop();
});

describe("US-020 orchestration checklist", () => {
  it("exposes an idempotent production provider-400 no-seat observation", async () => {
    await owner.query(
      `INSERT INTO user_account
         (id,email,idp_subject,global_role,ui_language,status,created_at)
       VALUES ('00000000-0000-0000-0000-000000000001','system@ledger.invalid',
               'ledger-system',NULL,'en','active',$1)`,
      [occurredAt],
    );
    await expect(service.observeProviderNoSeat(ids.request)).resolves.toEqual({
      requestId: ids.request,
      status: "blocked_no_seat",
    });
    await expect(service.observeProviderNoSeat(ids.request)).resolves.toEqual({
      requestId: ids.request,
      status: "blocked_no_seat",
    });
    const evidence = await owner.query(
      `SELECT request.state,
              (SELECT count(*)::int FROM request_transition
               WHERE request_id=request.id AND to_state='blocked_no_seat') AS transitions,
              (SELECT note FROM request_transition
               WHERE request_id=request.id AND to_state='blocked_no_seat') AS note,
              (SELECT count(*)::int FROM provisioning_action
               WHERE request_id=request.id) AS actions
       FROM license_request request WHERE request.id=$1`,
      [ids.request],
    );
    expect(evidence.rows).toEqual([{
      actions: 0,
      note: "provider_400",
      state: "blocked_no_seat",
      transitions: 1,
    }]);
  });

  it.skipIf(!mailpitSmtpUrl)(
    "dispatches the active lifecycle message only after a successful checklist action commit",
    async () => {
      await owner.query(
        `INSERT INTO system_setting (key,value,updated_at,updated_by)
         VALUES ('notif_sender_email','"notificaciones@ledger.test"'::jsonb,$1,$2)`,
        [occurredAt, ids.admin],
      );
      const database = drizzle(actionPool, { schema });
      process.env.SMTP_URL = mailpitSmtpUrl;
      process.env.PUBLIC_ORIGIN = "https://ledger.example.test";
      const hookedActionService = createProductionChecklistActionService(database, {
        loadAuthorization: async () => authorization,
        now: () => occurredAt,
      });
      const action = await service.routeApprovedRequest(
        authorization,
        ids.request,
      );

      await expect(
        hookedActionService.confirmChecklistDone({
          actionId: action.id,
          confirmationId: "us016-hook-success",
        }),
      ).resolves.toEqual({ ok: true, requestId: ids.request });
      await owner.query(
        `INSERT INTO lifecycle_notification
           (request_id,company_id,kind,recipient_user_account_id,
            recipient_email,recipient_locale,request_state,dedupe_key,created_at)
         SELECT request_id,company_id,kind,recipient_user_account_id,
                recipient_email,recipient_locale,request_state,
                dedupe_key || ':guard',created_at
         FROM lifecycle_notification
         WHERE request_id=$1`,
        [ids.request],
      );
      await expect(
        hookedActionService.confirmChecklistDone({
          actionId: action.id,
          confirmationId: "us016-hook-conflict",
        }),
      ).resolves.toEqual({ ok: false, error: "conflict" });
      await expect(
        hookedActionService.confirmChecklistDone({
          actionId: "not-a-uuid",
          confirmationId: "us016-hook-invalid",
        }),
      ).resolves.toEqual({ ok: false, error: "invalid" });

      const delivery = await owner.query(
        `SELECT notification.kind, notification.request_state, delivery.phase,
                delivery.worker_id
         FROM lifecycle_notification notification
         JOIN lifecycle_notification_delivery delivery
           ON delivery.notification_id=notification.id
         WHERE notification.request_id=$1
           AND delivery.phase='succeeded'`,
        [ids.request],
      );
      expect(delivery.rows).toEqual([
        {
          kind: "provisioning_complete",
          request_state: "active",
          phase: "succeeded",
          worker_id: "web-checklist-confirmation",
        },
      ]);
      const pending = await owner.query(
        `SELECT count(*)::int AS count
         FROM lifecycle_notification pending
         WHERE pending.request_id=$1
           AND NOT EXISTS (
             SELECT 1 FROM lifecycle_notification_delivery delivery
             WHERE delivery.notification_id=pending.id
               AND delivery.phase='succeeded'
           )`,
        [ids.request],
      );
      expect(pending.rows).toEqual([{ count: 1 }]);
    },
  );

  it("records tenant-exact sanitized evidence after an active checklist commit when inline dispatch rejects", async () => {
    const database = drizzle(actionPool, { schema });
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    const failingActionService = createChecklistActionService(database, {
      lifecycleDispatcher: {
        dispatchRequest: async () => {
          throw new Error("provider details must not escape");
        },
      },
      loadAuthorization: async () => authorization,
      now: () => occurredAt,
    });

    await expect(
      failingActionService.confirmChecklistDone({
        actionId: action.id,
        confirmationId: "postcommit-failure-evidence",
      }),
    ).resolves.toEqual({ ok: true, requestId: ids.request });

    const evidence = await owner.query<{
      action: string;
      actor_user_id: string;
      after: unknown;
      company_id: string;
      entity_id: string;
      entity_type: string;
    }>(
      `SELECT actor_user_id::text, action, entity_type, entity_id::text,
              company_id::text, after
       FROM audit_log
       WHERE action='notification.post_commit_dispatch_failed'`,
    );
    expect(evidence.rows).toEqual([
      {
        actor_user_id: ids.admin,
        action: "notification.post_commit_dispatch_failed",
        entity_type: "ProvisioningAction",
        entity_id: action.id,
        company_id: ids.company,
        after: { errorCode: "POST_COMMIT_DISPATCH_FAILED" },
      },
    ]);

    const committedState = await owner.query(
      `SELECT request.state, request.company_id::text,
              assignment.company_id::text AS assignment_company_id,
              assignment.ended_on
       FROM license_request request
       JOIN license_assignment assignment
         ON assignment.id=request.license_assignment_id
        AND assignment.source_request_id=request.id
       WHERE request.id=$1`,
      [ids.request],
    );
    expect(committedState.rows).toEqual([
      {
        state: "active",
        company_id: ids.company,
        assignment_company_id: ids.company,
        ended_on: null,
      },
    ]);
  });

  it.each([
    {
      expected: { ok: false, error: "invalid" },
      input: {
        actionId: "not-a-uuid",
        confirmationId: "invalid-no-evidence",
      },
      role: "group_admin" as const,
      scenario: "invalid",
    },
    {
      expected: { ok: false, error: "forbidden" },
      input: {
        actionId: ids.action,
        confirmationId: "forbidden-no-evidence",
      },
      role: "central_finance" as const,
      scenario: "forbidden",
    },
  ])("does not record post-commit dispatch evidence for a $scenario checklist call", async ({
    expected,
    input,
    role,
  }) => {
    const database = drizzle(actionPool, { schema });
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    const requestAuthorization: LedgerAuthorization = {
      ...authorization,
      globalRole: role,
      roles: [role],
    };
    const dispatchFailure = {
      dispatchRequest: async () => {
        throw new Error("provider details must not escape");
      },
    };
    const guardedService = createChecklistActionService(database, {
      lifecycleDispatcher: dispatchFailure,
      loadAuthorization: async () => requestAuthorization,
      now: () => occurredAt,
    });

    await expect(
      guardedService.confirmChecklistDone({
        ...input,
        actionId: input.actionId === ids.action ? action.id : input.actionId,
      }),
    ).resolves.toEqual(expected);

    const evidence = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id, after
       FROM audit_log
       WHERE action='notification.post_commit_dispatch_failed'`,
    );
    expect(evidence.rows).toEqual([]);
  });

  it("requires group_admin and refuses a cross-tenant request/person join", async () => {
    await expect(
      service.routeApprovedRequest(
        { ...authorization, globalRole: "central_finance", roles: ["central_finance"] },
        ids.request,
      ),
    ).rejects.toThrow("CHECKLIST_FORBIDDEN");

    await owner.query("UPDATE person SET company_id = $1 WHERE id = $2", [
      ids.otherCompany,
      ids.person,
    ]);
    await expect(
      service.routeApprovedRequest(authorization, ids.request),
    ).rejects.toThrow("CHECKLIST_REQUEST_NOT_FOUND");
  });

  it("rejects invalid identifiers and requests outside the approved route state", async () => {
    await expect(
      service.routeApprovedRequest(authorization, "not-a-uuid"),
    ).rejects.toThrow("requestId must be a UUID");
    await owner.query(
      "UPDATE license_request SET state = 'submitted' WHERE id = $1",
      [ids.request],
    );
    await expect(
      service.routeApprovedRequest(authorization, ids.request),
    ).rejects.toThrow("CHECKLIST_REQUEST_NOT_APPROVED");
  });

  it("blocks an approved request instead of issuing an action when the pool has no free seat", async () => {
    await owner.query(
      `INSERT INTO user_account
         (id,email,idp_subject,global_role,ui_language,status,created_at)
       VALUES ('00000000-0000-0000-0000-000000000001','system@ledger.invalid',
               'ledger-system',NULL,'en','active',$1)`,
      [occurredAt],
    );
    await owner.query(
      `UPDATE vendor_account_capacity SET purchased_qty=0
       WHERE vendor_account_id=$1 AND license_type_id=$2`,
      [ids.account, ids.licenseType],
    );

    await expect(
      service.routeApprovedRequest(authorization, ids.request),
    ).resolves.toEqual({
      requestId: ids.request,
      status: "blocked_no_seat",
    });
    const evidence = await owner.query(
      `SELECT request.state,
              (SELECT count(*)::int FROM provisioning_action action
               WHERE action.request_id=request.id) AS actions,
              (SELECT note FROM request_transition transition
               WHERE transition.request_id=request.id
                 AND transition.to_state='blocked_no_seat') AS note
       FROM license_request request WHERE request.id=$1`,
      [ids.request],
    );
    expect(evidence.rows).toEqual([{
      actions: 0,
      note: "pool_empty",
      state: "blocked_no_seat",
    }]);
  });

  it("rejects confirmation when the reserved action no longer has an available seat", async () => {
    const action = await service.routeApprovedRequest(authorization, ids.request);
    await owner.query(
      `UPDATE vendor_account_capacity SET purchased_qty=0
       WHERE vendor_account_id=$1 AND license_type_id=$2`,
      [ids.account, ids.licenseType],
    );
    await expect(
      service.confirmChecklistDone(authorization, {
        actionId: action.id,
        confirmationId: "capacity-lost-before-confirmation",
      }),
    ).rejects.toThrow("CHECKLIST_CAPACITY_UNAVAILABLE");
    const state = await owner.query(
      `SELECT request.state,action.status
       FROM license_request request
       JOIN provisioning_action action ON action.request_id=request.id
       WHERE action.id=$1`,
      [action.id],
    );
    expect(state.rows).toEqual([{ state: "provisioning", status: "pending" }]);
  });

  it("rejects a valid but unknown checklist action identifier", async () => {
    await expect(
      service.confirmChecklistDone(authorization, {
        actionId: ids.action,
        confirmationId: "unknown-action",
      }),
    ).rejects.toThrow("CHECKLIST_ACTION_NOT_PENDING");
  });

  it("routes an approved unsupported request to one canonical checklist and provisioning", async () => {
    const routed = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.routeApprovedRequest(authorization, ids.request)),
    );
    const [first, replay] = routed;
    expect(first).toBeDefined();
    expect(replay).toBeDefined();

    expect(first!).toMatchObject({
      kind: "checklist",
      mode: "orchestration",
      status: "pending",
    });
    expect(routed.every((item) => item.id === first!.id)).toBe(true);

    const persisted = await owner.query(
      `SELECT request.state, action.kind, action.mode, action.status,
              action.raw_request
       FROM license_request request
       JOIN provisioning_action action ON action.request_id = request.id
       WHERE request.id = $1`,
      [ids.request],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      kind: "checklist",
      mode: "orchestration",
      state: "provisioning",
      status: "pending",
      raw_request: {
        checklistSteps: expect.arrayContaining([
          expect.objectContaining({
            messageKey: "connector.manual.invite_person",
            params: {
              licenseTypeName: "Generic seat",
              personEmail: "person@example.com",
            },
          }),
        ]),
        operation: "provision",
        version: 1,
        context: {
          companyId: ids.company,
          requestId: ids.request,
        },
      },
    });
    await expect(
      service.pendingChecklist(authorization, ids.request),
    ).resolves.toEqual({
      id: first!.id,
      rawRequest: first!.rawRequest,
      status: "pending",
    });
    await expect(
      service.pendingChecklist(authorization, "not-a-uuid"),
    ).resolves.toBeNull();
    const history = await owner.query(
      `SELECT action, entity_type, entity_id, company_id, before, after
       FROM audit_log
       WHERE entity_id = $1 OR entity_id = $2
       ORDER BY occurred_at, action`,
      [ids.request, first!.id],
    );
    expect(history.rows).toEqual([
      {
        action: "orchestration.checklist_issued",
        after: {
          kind: "checklist",
          mode: "orchestration",
          requestId: ids.request,
          status: "pending",
        },
        before: null,
        company_id: ids.company,
        entity_id: first!.id,
        entity_type: "ProvisioningAction",
      },
      {
        action: "request.provisioning",
        after: { state: "provisioning" },
        before: { state: "approved" },
        company_id: ids.company,
        entity_id: ids.request,
        entity_type: "LicenseRequest",
      },
    ]);
    const transition = await owner.query(
      `SELECT from_state, to_state, note
       FROM request_transition WHERE request_id = $1`,
      [ids.request],
    );
    expect(transition.rows).toEqual([{
      from_state: "approved",
      note: "Orchestration checklist issued",
      to_state: "provisioning",
    }]);
  });

  it("hides malformed persisted steps and rejects a checklist replay in an incompatible request state", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await owner.query(
      `UPDATE provisioning_action
       SET raw_request = '{"operation":"provision","checklistSteps":["unsafe"]}'
       WHERE id = $1`,
      [action.id],
    );
    await expect(
      service.pendingChecklist(authorization, ids.request),
    ).resolves.toBeNull();
    await expect(
      service.routeApprovedRequest(authorization, ids.request),
    ).rejects.toThrow();
    await owner.query(
      "UPDATE provisioning_action SET raw_request = $1 WHERE id = $2",
      [action.rawRequest, action.id],
    );
    await owner.query(
      "UPDATE license_request SET state = 'approved' WHERE id = $1",
      [ids.request],
    );
    await expect(
      service.routeApprovedRequest(authorization, ids.request),
    ).rejects.toThrow("CHECKLIST_REPLAY_STATE_CONFLICT");
  });

  it("confirms one exact pending checklist atomically and replays the same attestation", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    const input = {
      actionId: action.id,
      confirmationId: "confirm-1",
    };

    const first = await service.confirmChecklistDone(authorization, input);
    const replay = await service.confirmChecklistDone(authorization, input);
    expect(first).toEqual({
      assignmentId: first.assignmentId,
      requestId: ids.request,
      status: "active",
    });
    expect(replay).toEqual(first);

    const result = await owner.query(
      `SELECT request.state, request.license_assignment_id,
              action.status, action.resolved_at,
              assignment.started_on::text AS started_on,
              assignment.source_request_id, assignment.company_id
       FROM license_request request
       JOIN provisioning_action action ON action.request_id = request.id
       JOIN license_assignment assignment
         ON assignment.id = request.license_assignment_id
       WHERE request.id = $1`,
      [ids.request],
    );
    expect(result.rows).toMatchObject([{
      company_id: ids.company,
      license_assignment_id: first.assignmentId,
      source_request_id: ids.request,
      started_on: "2026-07-28",
      state: "active",
      status: "confirmed",
    }]);
    const confirmationAudit = await owner.query(
      `SELECT note, before, after
       FROM audit_log
       WHERE entity_id = $1
         AND action = 'orchestration.checklist_confirmed'`,
      [action.id],
    );
    expect(confirmationAudit.rows).toEqual([{
      after: {
        assignmentId: first.assignmentId,
        attestedOn: "2026-07-28",
        confirmationId: "confirm-1",
        status: "confirmed",
      },
      before: { status: "pending" },
      note: null,
    }]);
    const notifications = await owner.query(
      `SELECT kind, request_state, company_id, recipient_email
       FROM lifecycle_notification
       WHERE request_id=$1`,
      [ids.request],
    );
    expect(notifications.rows).toEqual([
      {
        kind: "provisioning_complete",
        request_state: "active",
        company_id: ids.company,
        recipient_email: "admin@checklist.test",
      },
    ]);
    await expect(
      service.routeApprovedRequest(authorization, ids.request),
    ).resolves.toMatchObject({ id: action.id, status: "confirmed" });
    const transitions = await owner.query(
      `SELECT from_state, to_state, note FROM request_transition
       WHERE request_id = $1 ORDER BY occurred_at, id`,
      [ids.request],
    );
    expect(
      transitions.rows.find((row) => row.to_state === "active"),
    ).toEqual({
      from_state: "provisioning",
      note: "Orchestration checklist attested",
      to_state: "active",
    });
    await expect(
      service.confirmChecklistDone(authorization, {
        ...input,
        confirmationId: "different-confirmation",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("derives the attestation date from the trusted Ecuador clock across the UTC boundary", async () => {
    let trustedNow = new Date("2026-07-30T04:59:00.000Z");
    const boundaryService = createOrchestrationService(applicationUrl, {
      now: () => trustedNow,
    }) as SeatAvailableService;
    try {
      const action = await boundaryService.routeApprovedRequest(
        authorization,
        ids.request,
      );
      for (const attestedOn of ["1999-01-01", "2099-01-01"]) {
        await expect(
          boundaryService.confirmChecklistDone(authorization, {
            actionId: action.id,
            attestedOn,
            confirmationId: `hostile-${attestedOn}`,
          }),
        ).rejects.toThrow();
      }

      const input = {
        actionId: action.id,
        confirmationId: "trusted-boundary",
      };
      const first = await boundaryService.confirmChecklistDone(
        authorization,
        input,
      );
      trustedNow = new Date("2026-07-30T05:01:00.000Z");
      await expect(
        boundaryService.confirmChecklistDone(authorization, input),
      ).resolves.toEqual(first);

      const evidence = await owner.query(
        `SELECT assignment.started_on::text AS started_on,
                audit.after->>'attestedOn' AS attested_on,
                audit.occurred_at,
                (SELECT count(*)::int FROM audit_log replay
                 WHERE replay.entity_id = action.id
                   AND replay.action = 'orchestration.checklist_confirmed')
                   AS confirmations
         FROM provisioning_action action
         JOIN license_request request ON request.id = action.request_id
         JOIN license_assignment assignment
           ON assignment.id = request.license_assignment_id
         JOIN audit_log audit
           ON audit.entity_id = action.id
          AND audit.action = 'orchestration.checklist_confirmed'
         WHERE action.id = $1`,
        [action.id],
      );
      expect(evidence.rows).toEqual([{
        attested_on: "2026-07-29",
        confirmations: 1,
        occurred_at: new Date("2026-07-30T04:59:00.000Z"),
        started_on: "2026-07-29",
      }]);
    } finally {
      await boundaryService.close();
    }
  });

  it("rejects hostile attestation fields and non-pending checklist confirmation", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await expect(
      service.confirmChecklistDone(authorization, {
        actionId: action.id,
        attestedOn: "2026-02-30",
        confirmationId: "invalid-date",
      }),
    ).rejects.toThrow();
    await owner.query(
      "UPDATE provisioning_action SET status = 'confirmed' WHERE id = $1",
      [action.id],
    );
    await expect(
      service.confirmChecklistDone(authorization, {
        actionId: action.id,
        confirmationId: "wrong-request",
      }),
    ).rejects.toThrow("CHECKLIST_ACTION_NOT_PENDING");
  });

  it("accepts the legal sent checklist status and rejects the wrong request state", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await owner.query(
      "UPDATE provisioning_action SET status = 'sent' WHERE id = $1",
      [action.id],
    );
    await expect(
      service.confirmChecklistDone(authorization, {
        actionId: action.id,
        confirmationId: "sent-confirmation",
      }),
    ).resolves.toMatchObject({ status: "active" });
    const confirmationAudit = await owner.query(
      `SELECT before, after
       FROM audit_log
       WHERE entity_id = $1
         AND action = 'orchestration.checklist_confirmed'`,
      [action.id],
    );
    expect(confirmationAudit.rows).toMatchObject([
      {
        before: { status: "sent" },
        after: { status: "confirmed" },
      },
    ]);

    await owner.query(
      "UPDATE license_request SET state = 'approved' WHERE id = $1",
      [ids.failureRequest],
    );
    await expect(
      service.markChecklistNotDone(authorization, {
        actionId: ids.failureAction,
        failureId: "wrong-state",
        reason: "wrong state",
      }),
    ).rejects.toThrow("CHECKLIST_ACTION_NOT_PENDING");
  });

  it("rejects confirmation when a pending checklist request is not provisioning", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await owner.query(
      "UPDATE license_request SET state = 'approved' WHERE id = $1",
      [ids.request],
    );
    await expect(
      service.confirmChecklistDone(authorization, {
        actionId: action.id,
        confirmationId: "wrong-state-confirmation",
      }),
    ).rejects.toThrow("CHECKLIST_ACTION_NOT_PENDING");
  });

  it("serializes concurrent equal confirmations to the same assignment", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    const input = {
      actionId: action.id,
      confirmationId: "confirm-concurrent",
    };
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.confirmChecklistDone(authorization, input)),
    );
    expect(results.every(
      (item) => item.assignmentId === results[0]?.assignmentId,
    )).toBe(true);
    const assignments = await owner.query(
      "SELECT count(*)::int AS count FROM license_assignment WHERE source_request_id = $1",
      [ids.request],
    );
    expect(assignments.rows).toEqual([{ count: 1 }]);
  });

  it("marks a checklist not done only with a reason and preserves legal failure history", async () => {
    await expect(
      service.markChecklistNotDone(authorization, {
        actionId: ids.failureAction,
        failureId: "failure-1",
        reason: " ",
      }),
    ).rejects.toThrow("FAILURE_REASON_REQUIRED");

    const failureInput = {
        actionId: ids.failureAction,
        failureId: "failure-1",
        reason: "Provider console rejected the invitation",
      };
    const failed = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.markChecklistNotDone(authorization, failureInput)),
    );
    expect(failed).toEqual(
      Array.from({ length: 12 }, () => ({
        requestId: ids.failureRequest,
        status: "failed",
      })),
    );
    await expect(
      service.markChecklistNotDone(authorization, {
        actionId: ids.failureAction,
        failureId: "failure-1",
        reason: "Provider console rejected the invitation",
      }),
    ).resolves.toEqual({
      requestId: ids.failureRequest,
      status: "failed",
    });
    await expect(
      service.markChecklistNotDone(authorization, {
        actionId: ids.failureAction,
        failureId: "failure-1",
        reason: "Different reason",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(
      service.markChecklistNotDone(authorization, {
        actionId: ids.failureAction,
        failureId: "different-failure",
        reason: "Provider console rejected the invitation",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const persisted = await owner.query(
      `SELECT request.state, action.status, action.failure_reason
       FROM provisioning_action action
       JOIN license_request request ON request.id = action.request_id
       WHERE action.id = $1`,
      [ids.failureAction],
    );
    expect(persisted.rows).toEqual([{
      failure_reason: "Provider console rejected the invitation",
      state: "failed",
      status: "failed",
    }]);
    const failureEvidence = await owner.query(
      `SELECT note, before, after FROM audit_log
       WHERE entity_id = $1 AND action = 'orchestration.checklist_failed'`,
      [ids.failureAction],
    );
    expect(failureEvidence.rows).toEqual([{
      after: {
        failureId: "failure-1",
        reason: "Provider console rejected the invitation",
        status: "failed",
      },
      before: { status: "pending" },
      note: "Provider console rejected the invitation",
    }]);
    await expect(
      service.routeApprovedRequest(authorization, ids.failureRequest),
    ).resolves.toMatchObject({
      id: ids.failureAction,
      status: "failed",
    });
  });

  it("accepts sent status when marking a checklist not done", async () => {
    await owner.query(
      "UPDATE provisioning_action SET status = 'sent' WHERE id = $1",
      [ids.failureAction],
    );
    await expect(
      service.markChecklistNotDone(authorization, {
        actionId: ids.failureAction,
        failureId: "sent-failure",
        reason: "Console unavailable",
      }),
    ).resolves.toEqual({
      requestId: ids.failureRequest,
      status: "failed",
    });
    const failureAudit = await owner.query(
      `SELECT before, after
       FROM audit_log
       WHERE entity_id = $1
         AND action = 'orchestration.checklist_failed'`,
      [ids.failureAction],
    );
    expect(failureAudit.rows).toMatchObject([
      {
        before: { status: "sent" },
        after: { status: "failed" },
      },
    ]);
  });

  it("executes checklist server mutations through one audited transaction boundary", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await expect(
      actionService.confirmChecklistDone({
        actionId: action.id,
        confirmationId: "server-action-confirm",
      }),
    ).resolves.toEqual({ ok: true, requestId: ids.request });
    await expect(
      actionService.confirmChecklistDone({
        actionId: action.id,
        confirmationId: "different-confirmation",
      }),
    ).resolves.toEqual({ ok: false, error: "conflict" });
    await expect(
      actionService.markChecklistNotDone({
        actionId: "not-a-uuid",
        failureId: "invalid",
        reason: "No aplica",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid" });
    await expect(
      actionService.markChecklistNotDone({
        actionId: ids.failureAction,
        failureId: "server-action-failure",
        reason: "La consola rechazó la invitación.",
      }),
    ).resolves.toEqual({ ok: true, requestId: ids.failureRequest });

    const evidence = await owner.query(
      `SELECT action, entity_type, entity_id::text, after, occurred_at
       FROM audit_log
       WHERE action LIKE 'server_action.%'
       ORDER BY action, after->>'accepted' DESC NULLS LAST`,
    );
    expect(evidence.rows).toEqual([
      {
        action: "server_action.confirmChecklistDone",
        entity_type: "ProvisioningAction",
        entity_id: action.id,
        after: { accepted: true },
        occurred_at: occurredAt,
      },
      {
        action: "server_action.confirmChecklistDone",
        entity_type: "ProvisioningAction",
        entity_id: action.id,
        after: { accepted: false, errorCode: "conflict" },
        occurred_at: occurredAt,
      },
      {
        action: "server_action.markChecklistNotDone",
        entity_type: "ProvisioningAction",
        entity_id: ids.failureAction,
        after: { accepted: true },
        occurred_at: occurredAt,
      },
      {
        action: "server_action.markChecklistNotDone",
        entity_type: "ProvisioningAction",
        entity_id: "00000000-0000-0000-0000-000000000005",
        after: { accepted: false, errorCode: "invalid" },
        occurred_at: occurredAt,
      },
    ]);
    const coreEvidence = await owner.query(
      `SELECT action, occurred_at
       FROM audit_log
       WHERE action IN (
         'orchestration.checklist_confirmed',
         'orchestration.checklist_failed'
       )
       ORDER BY action`,
    );
    expect(coreEvidence.rows).toEqual([
      {
        action: "orchestration.checklist_confirmed",
        occurred_at: occurredAt,
      },
      {
        action: "orchestration.checklist_failed",
        occurred_at: occurredAt,
      },
    ]);
  });

  it("audits a forbidden checklist server mutation without changing the action", async () => {
    const anonymousService = createChecklistActionService(
      drizzle(actionPool, { schema }),
      {
        loadAuthorization: async () => null,
        now: () => occurredAt,
      },
    );
    await expect(
      anonymousService.markChecklistNotDone({
        actionId: ids.failureAction,
        failureId: "forbidden-failure",
        reason: "No debe mutar",
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(
      anonymousService.confirmChecklistDone({
        actionId: ids.failureAction,
        confirmationId: "anonymous-forbidden-confirmation",
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    const scopedService = createChecklistActionService(
      drizzle(actionPool, { schema }),
      {
        loadAuthorization: async () => ({
          ...authorization,
          globalRole: "central_finance",
          roles: ["central_finance"],
        }),
        now: () => occurredAt,
      },
    );
    await expect(
      scopedService.confirmChecklistDone({
        actionId: ids.failureAction,
        confirmationId: "forbidden-confirmation",
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(
      scopedService.markChecklistNotDone({
        actionId: ids.failureAction,
        failureId: "scoped-forbidden-failure",
        reason: "No debe mutar",
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });

    const action = await owner.query(
      `SELECT status, failure_reason
       FROM provisioning_action WHERE id = $1`,
      [ids.failureAction],
    );
    const denial = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id::text, after
       FROM audit_log WHERE action = 'authorization.denied'
       ORDER BY after->>'capability', actor_user_id NULLS FIRST`,
    );
    expect(action.rows).toEqual([
      { status: "pending", failure_reason: null },
    ]);
    expect(denial.rows).toEqual([
      {
        actor_user_id: null,
        action: "authorization.denied",
        entity_type: "ProvisioningAction",
        entity_id: ids.failureAction,
        after: {
          capability: "orchestration:confirm",
          errorCode: "capability_forbidden",
        },
      },
      {
        actor_user_id: ids.admin,
        action: "authorization.denied",
        entity_type: "ProvisioningAction",
        entity_id: ids.failureAction,
        after: {
          capability: "orchestration:confirm",
          errorCode: "capability_forbidden",
        },
      },
      {
        actor_user_id: null,
        action: "authorization.denied",
        entity_type: "ProvisioningAction",
        entity_id: ids.failureAction,
        after: {
          capability: "orchestration:fail",
          errorCode: "capability_forbidden",
        },
      },
      {
        actor_user_id: ids.admin,
        action: "authorization.denied",
        entity_type: "ProvisioningAction",
        entity_id: ids.failureAction,
        after: {
          capability: "orchestration:fail",
          errorCode: "capability_forbidden",
        },
      },
    ]);
  });

  it("rejects failure commands for non-pending checklist actions", async () => {
    await owner.query(
      "UPDATE provisioning_action SET status = 'confirmed' WHERE id = $1",
      [ids.failureAction],
    );
    await expect(
      service.markChecklistNotDone(authorization, {
        actionId: ids.failureAction,
        failureId: "late-failure",
        reason: "Too late",
      }),
    ).rejects.toThrow("CHECKLIST_ACTION_NOT_PENDING");
  });

  it("excludes failed actions whose request holder no longer matches the request tenant", async () => {
    await owner.query(
      `UPDATE provisioning_action
       SET status = 'failed', failure_reason = 'No debe filtrarse a otro tenant'
       WHERE id = $1`,
      [ids.failureAction],
    );
    await owner.query(
      `UPDATE person SET company_id = $1 WHERE id = $2`,
      [ids.otherCompany, ids.person],
    );

    await expect(
      service.verificationFailures(authorization),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("records later mismatch evidence without removing the active assignment", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    const confirmed = await service.confirmChecklistDone(authorization, {
      actionId: action.id,
      confirmationId: "confirm-observation",
    });

    const mismatchInput = {
        actionId: action.id,
        observedAssigned: false,
        observedAt: new Date("2026-07-29T15:00:00.000Z"),
        observationId: "observation-1",
        source: "member_sync",
      } as const;
    const mismatches = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.verifyChecklistObservation(mismatchInput)),
    );
    expect(mismatches).toEqual(
      Array.from({ length: 12 }, () => ({
        status: "verification_failed",
      })),
    );
    await expect(
      service.verifyChecklistObservation({
        actionId: action.id,
        observedAssigned: false,
        observedAt: new Date("2026-07-29T15:00:00.000Z"),
        observationId: "observation-1",
        source: "member_sync",
      }),
    ).resolves.toEqual({ status: "verification_failed" });

    const evidence = await owner.query(
      `SELECT request.state, action.status, action.failure_reason,
              assignment.ended_on,
              (SELECT count(*)::int FROM alert_event
               WHERE subject_ref->>'actionId' = action.id::text) AS alerts
       FROM provisioning_action action
       JOIN license_request request ON request.id = action.request_id
       JOIN license_assignment assignment ON assignment.id = $2
       WHERE action.id = $1`,
      [action.id, confirmed.assignmentId],
    );
    expect(evidence.rows).toEqual([{
      alerts: 1,
      ended_on: null,
      failure_reason:
        "checklist_assignment_missing|Member synchronization did not find the attested active assignment.",
      state: "active",
      status: "verification_failed",
    }]);
    const alertEvidence = await owner.query(
      `SELECT dedupe_key, subject_ref FROM alert_event`,
    );
    expect(alertEvidence.rows).toEqual([{
      dedupe_key: `checklist-verification:${action.id}:observation-1`,
      subject_ref: {
        actionId: action.id,
        companyId: ids.company,
        exception: "checklist_verification_failed",
        source: "member_sync",
      },
    }]);
    const observationAudit = await owner.query(
      `SELECT before, after FROM audit_log
       WHERE entity_id = $1 AND action = 'orchestration.checklist_observed'`,
      [action.id],
    );
    expect(observationAudit.rows).toEqual([{
      after: {
        observationId: "observation-1",
        observedAssigned: false,
        observedAt: "2026-07-29T15:00:00.000Z",
        source: "member_sync",
        status: "verification_failed",
      },
      before: { status: "confirmed" },
    }]);
    await service.markChecklistNotDone(authorization, {
      actionId: ids.failureAction,
      failureId: "exception-failed",
      reason: "La consola rechazó la invitación.",
    });
    await owner.query(
      `UPDATE provisioning_action
       SET vendor_ref = 'inv_real_9f27',
           sent_at = '2026-07-18T12:00:00.000Z'
       WHERE id = $1`,
      [ids.failureAction],
    );
    await expect(
      service.verificationFailures(authorization),
    ).resolves.toEqual({
      items: [
      {
        actionId: action.id,
        companyName: "Checklist tenant",
        failureReason:
          "checklist_assignment_missing|Member synchronization did not find the attested active assignment.",
        kind: "checklist",
        mode: "orchestration",
        personEmail: "person@example.com",
        requestId: ids.request,
        requestNo: "REQ-CHECK-1",
        sentAt: null,
        status: "verification_failed",
        vendorAccountName: "Manual org",
        vendorRef: null,
      },
      {
        actionId: ids.failureAction,
        companyName: "Checklist tenant",
        failureReason: "La consola rechazó la invitación.",
        kind: "checklist",
        mode: "orchestration",
        personEmail: "person@example.com",
        requestId: ids.failureRequest,
        requestNo: "REQ-CHECK-2",
        sentAt: "2026-07-18T12:00:00.000Z",
        status: "failed",
        vendorAccountName: "Manual org",
        vendorRef: "inv_real_9f27",
      },
      ],
      nextCursor: null,
    });
    const firstFailurePage = await service.verificationFailures(authorization, {
      limit: 1,
    });
    expect(firstFailurePage.items.map(({ actionId }) => actionId)).toEqual([
      action.id,
    ]);
    expect(firstFailurePage.nextCursor).toMatch(
      new RegExp(`\\|${action.id}$`),
    );
    await expect(
      service.verificationFailures(authorization, {
        cursor: firstFailurePage.nextCursor,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      items: [{ actionId: ids.failureAction }],
      nextCursor: null,
    });
    await expect(
      service.verificationFailures({
        ...authorization,
        globalRole: "central_finance",
        roles: ["central_finance"],
      }),
    ).rejects.toThrow("CHECKLIST_FORBIDDEN");
    for (const cursor of [
      `|${action.id}`,
      `not-a-date|${action.id}`,
      "2026-07-29T15:00:00.000Z|not-a-uuid",
    ]) {
      await expect(
        service.verificationFailures(authorization, { cursor, limit: 1 }),
      ).resolves.toMatchObject({
        items: [{ actionId: action.id }],
      });
    }
    await expect(
      service.verifyChecklistObservation({
        actionId: action.id,
        observedAssigned: true,
        observedAt: new Date("2026-07-29T15:00:00.000Z"),
        observationId: "observation-1",
        source: "member_sync",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(
      service.verifyChecklistObservation({
        actionId: action.id,
        observedAssigned: false,
        observedAt: new Date("2026-07-29T16:00:00.000Z"),
        observationId: "observation-1",
        source: "member_sync",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("rejects invalid or inapplicable observations and rolls back without an alert rule", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await expect(
      service.verifyChecklistObservation({
        actionId: action.id,
        observedAssigned: false,
        observedAt: new Date(Number.NaN),
        observationId: "invalid-instant",
        source: "member_sync",
      }),
    ).rejects.toThrow();
    await expect(
      service.verifyChecklistObservation({
        actionId: action.id,
        observedAssigned: false,
        observedAt: new Date("2026-07-29T15:00:00.000Z"),
        observationId: "too-early",
        source: "member_sync",
      }),
    ).rejects.toThrow("CHECKLIST_OBSERVATION_NOT_APPLICABLE");

    await service.confirmChecklistDone(authorization, {
      actionId: action.id,
      confirmationId: "confirm-no-rule",
    });
    await owner.query(
      "UPDATE license_request SET state = 'provisioning' WHERE id = $1",
      [ids.request],
    );
    await expect(
      service.verifyChecklistObservation({
        actionId: action.id,
        observedAssigned: false,
        observedAt: new Date("2026-07-29T15:00:00.000Z"),
        observationId: "wrong-state",
        source: "member_sync",
      }),
    ).rejects.toThrow("CHECKLIST_OBSERVATION_NOT_APPLICABLE");
    await owner.query(
      "UPDATE license_request SET state = 'active' WHERE id = $1",
      [ids.request],
    );
    await owner.query("DELETE FROM alert_rule");
    await expect(
      service.verifyChecklistObservation({
        actionId: action.id,
        observedAssigned: false,
        observedAt: new Date("2026-07-29T15:00:00.000Z"),
        observationId: "no-rule",
        source: "member_sync",
      }),
    ).rejects.toThrow("PROVISIONING_FAILURE_RULE_MISSING");
    const persisted = await owner.query(
      "SELECT status FROM provisioning_action WHERE id = $1",
      [action.id],
    );
    expect(persisted.rows).toEqual([{ status: "confirmed" }]);
  });

  it("lets the production member-sync port record an observation and close its pool", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await service.confirmChecklistDone(authorization, {
      actionId: action.id,
      confirmationId: "confirm-port",
    });
    const port = createMemberSyncChecklistObservationPort(applicationUrl);
    await expect(
      port.record({
        actionId: action.id,
        observedAssigned: true,
        observedAt: new Date("2026-07-29T15:00:00.000Z"),
        observationId: "member-sync-port",
        source: "member_sync",
      }),
    ).resolves.toEqual({ status: "confirmed" });
    await port.close();
    await expect(
      port.record({
        actionId: action.id,
        observedAssigned: true,
        observedAt: new Date("2026-07-30T15:00:00.000Z"),
        observationId: "member-sync-port-after-close",
        source: "member_sync",
      }),
    ).rejects.toThrow();
  });

  it("resolves a verification failure only after a matching later observation", async () => {
    const action = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await service.confirmChecklistDone(authorization, {
      actionId: action.id,
      confirmationId: "confirm-resolution",
    });
    await service.verifyChecklistObservation({
      actionId: action.id,
      observedAssigned: false,
      observedAt: new Date("2026-07-29T15:00:00.000Z"),
      observationId: "observation-mismatch",
      source: "member_sync",
    });
    await expect(
      service.verifyChecklistObservation({
        actionId: action.id,
        observedAssigned: true,
        observedAt: new Date("2026-07-30T16:00:00.000Z"),
        observationId: "observation-match",
        source: "member_sync",
      }),
    ).resolves.toEqual({ status: "confirmed" });
    const persisted = await owner.query(
      `SELECT status, resolved_at FROM provisioning_action WHERE id = $1`,
      [action.id],
    );
    expect(persisted.rows).toEqual([{
      resolved_at: new Date("2026-07-30T16:00:00.000Z"),
      status: "confirmed",
    }]);
    const alerts = await owner.query(
      "SELECT count(*)::int AS count FROM alert_event",
    );
    expect(alerts.rows).toEqual([{ count: 1 }]);
  });

  it("rejects distinct stale observations without regressing state, evidence, or alerts", async () => {
    const firstAction = await service.routeApprovedRequest(
      authorization,
      ids.request,
    );
    await service.confirmChecklistDone(authorization, {
      actionId: firstAction.id,
      confirmationId: "confirm-newer-match",
    });
    await service.verifyChecklistObservation({
      actionId: firstAction.id,
      observedAssigned: true,
      observedAt: new Date("2026-07-31T16:00:00.000Z"),
      observationId: "newer-match",
      source: "member_sync",
    });
    await expect(
      service.verifyChecklistObservation({
        actionId: firstAction.id,
        observedAssigned: false,
        observedAt: new Date("2026-07-31T16:00:00.000Z"),
        observationId: "equal-mismatch",
        source: "member_sync",
      }),
    ).rejects.toThrow("CHECKLIST_OBSERVATION_STALE");
    await expect(
      service.verifyChecklistObservation({
        actionId: firstAction.id,
        observedAssigned: false,
        observedAt: new Date("2026-07-30T16:00:00.000Z"),
        observationId: "older-mismatch",
        source: "member_sync",
      }),
    ).rejects.toThrow("CHECKLIST_OBSERVATION_STALE");

    await owner.query(
      "UPDATE license_request SET license_assignment_id = NULL WHERE id = $1",
      [ids.request],
    );
    await owner.query(
      "DELETE FROM license_assignment WHERE source_request_id = $1",
      [ids.request],
    );
    await service.confirmChecklistDone(authorization, {
      actionId: ids.failureAction,
      confirmationId: "confirm-newer-mismatch",
    });
    await service.verifyChecklistObservation({
      actionId: ids.failureAction,
      observedAssigned: false,
      observedAt: new Date("2026-07-31T17:00:00.000Z"),
      observationId: "newer-mismatch",
      source: "member_sync",
    });
    await expect(
      service.verifyChecklistObservation({
        actionId: ids.failureAction,
        observedAssigned: true,
        observedAt: new Date("2026-07-30T17:00:00.000Z"),
        observationId: "older-match",
        source: "member_sync",
      }),
    ).rejects.toThrow("CHECKLIST_OBSERVATION_STALE");

    const evidence = await owner.query(
      `SELECT id::text, status, failure_reason, resolved_at,
              (SELECT count(*)::int FROM audit_log audit
               WHERE audit.entity_id = action.id
                 AND audit.action = 'orchestration.checklist_observed')
                AS observations,
              (SELECT count(*)::int FROM alert_event alert
               WHERE alert.subject_ref->>'actionId' = action.id::text)
                AS alerts
       FROM provisioning_action action
       WHERE id IN ($1, $2)
       ORDER BY id`,
      [firstAction.id, ids.failureAction],
    );
    const byId = new Map(evidence.rows.map((row) => [row.id, row]));
    expect(byId.get(firstAction.id)).toEqual({
      alerts: 0,
      failure_reason: null,
      id: firstAction.id,
      observations: 1,
      resolved_at: new Date("2026-07-31T16:00:00.000Z"),
      status: "confirmed",
    });
    expect(byId.get(ids.failureAction)).toEqual({
      alerts: 1,
      failure_reason:
        "checklist_assignment_missing|Member synchronization did not find the attested active assignment.",
      id: ids.failureAction,
      observations: 1,
      resolved_at: new Date("2026-07-31T17:00:00.000Z"),
      status: "verification_failed",
    });
  });

  it("closes its database pool", async () => {
    const before = new Date();
    const disposable = createOrchestrationService(
      applicationUrl,
    ) as SeatAvailableService;
    const routed = await disposable.routeApprovedRequest(
      authorization,
      ids.request,
    );
    const after = new Date();
    const persisted = await owner.query(
      "SELECT created_at FROM provisioning_action WHERE id = $1",
      [routed.id],
    );
    expect(persisted.rows[0]?.created_at.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(persisted.rows[0]?.created_at.getTime()).toBeLessThanOrEqual(
      after.getTime(),
    );
    await disposable.close();
    await expect(
      disposable.pendingChecklist(authorization, ids.request),
    ).rejects.toThrow();
  });
});
