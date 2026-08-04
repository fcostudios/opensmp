import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import {
  createAuthorizationRepository,
  type LedgerAuthorization,
} from "../identity-access/authorization";
import {
  startOffboardingWithAuthorization,
} from "./people-action-core";
import {
  PeopleRepositoryError,
  createPeopleRepository,
} from "./repository";

const adminId = "00000000-0000-0000-0000-000000000201";
const viewerId = "00000000-0000-0000-0000-000000000202";
const companyA = "00000000-0000-0000-0000-000000000203";
const companyB = "00000000-0000-0000-0000-000000000204";
const personA = "00000000-0000-0000-0000-000000000205";
const personB = "00000000-0000-0000-0000-000000000206";
const vendorId = "00000000-0000-0000-0000-000000000207";
const vendorAccountId = "00000000-0000-0000-0000-000000000208";
const licenseTypeId = "00000000-0000-0000-0000-000000000209";
const assignmentId = "00000000-0000-0000-0000-000000000210";
const viewerGrantId = "00000000-0000-0000-0000-000000000211";
const vendorAccountId2 = "00000000-0000-0000-0000-000000000212";
const assignmentId2 = "00000000-0000-0000-0000-000000000213";
const licenseTypeId2 = "00000000-0000-0000-0000-000000000214";
const movePersonId = "00000000-0000-0000-0000-000000000215";
const confirmationAssignmentId =
  "00000000-0000-0000-0000-000000000216";
const noGrantId = "00000000-0000-0000-0000-000000000217";
const offboardingPersonId =
  "00000000-0000-0000-0000-000000000218";
const offboardingRequestId =
  "00000000-0000-0000-0000-000000000219";
const offboardingAssignmentId =
  "00000000-0000-0000-0000-000000000220";
const inactivePersonId = "00000000-0000-0000-0000-000000000221";
const inactiveRequestId = "00000000-0000-0000-0000-000000000222";
const inactiveAssignmentId =
  "00000000-0000-0000-0000-000000000223";
const reallocatedPersonId =
  "00000000-0000-0000-0000-000000000224";
const reallocatedRequestId =
  "00000000-0000-0000-0000-000000000225";
const reallocatedAssignmentId =
  "00000000-0000-0000-0000-000000000226";
const wrongStatePersonId =
  "00000000-0000-0000-0000-000000000227";
const wrongStateRequestId =
  "00000000-0000-0000-0000-000000000228";
const wrongStateAssignmentId =
  "00000000-0000-0000-0000-000000000229";
const noLicensePersonId =
  "00000000-0000-0000-0000-000000000230";
const tenantRequestId = "00000000-0000-0000-0000-000000000231";
const tenantAssignmentId =
  "00000000-0000-0000-0000-000000000232";
const rollbackPersonId = "00000000-0000-0000-0000-000000000233";
const rollbackRequestId =
  "00000000-0000-0000-0000-000000000234";
const rollbackAssignmentId =
  "00000000-0000-0000-0000-000000000235";
const singleMovePersonId =
  "00000000-0000-0000-0000-000000000236";
const singleMoveAssignmentId =
  "00000000-0000-0000-0000-000000000237";
const orderedPersonId =
  "00000000-0000-0000-0000-000000000238";
const orderedAssignmentId =
  "00000000-0000-0000-0000-000000000239";
const orderedAssignmentId2 =
  "00000000-0000-0000-0000-000000000240";
const orderedActivityId =
  "00000000-0000-0000-0000-000000000241";
const orderedActivityId2 =
  "00000000-0000-0000-0000-000000000242";
const orderedActivityId3 =
  "00000000-0000-0000-0000-000000000243";
const offboardingAssignmentId2 =
  "00000000-0000-0000-0000-000000000244";
const occurredAt = new Date("2026-07-27T15:00:00.000Z");

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;
let admin: LedgerAuthorization;
let viewer: LedgerAuthorization;
let noGrant: LedgerAuthorization;

async function waitForLockWaiters(
  client: pg.Client,
  minimum: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await client.query(
      `SELECT count(*)::int AS count
         FROM pg_locks
        WHERE NOT granted`,
    );
    if (result.rows[0].count >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const activity = await client.query(
    `SELECT locktype, mode, granted
       FROM pg_locks
      WHERE database = (SELECT oid FROM pg_database
                         WHERE datname = current_database())`,
  );
  throw new Error(
    `expected at least ${minimum} lock waiters: ${JSON.stringify(activity.rows)}`,
  );
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  appPool = new pg.Pool({ connectionString: fixture.appUrl });

  await owner.query(
    `INSERT INTO user_account
       (id, email, idp_subject, global_role, ui_language, status, created_at)
     VALUES
       ($1, 'people.admin@example.com', 'people-admin', 'group_admin', 'es', 'active', $3),
       ($2, 'people.viewer@example.com', 'people-viewer', NULL, 'es', 'active', $3),
       ($4, 'people.nogrant@example.com', 'people-nogrant', NULL, 'es', 'active', $3)`,
    [adminId, viewerId, occurredAt, noGrantId],
  );
  await owner.query(
    `INSERT INTO company
       (id, name, code, type, status, created_at, created_by)
     VALUES
       ($1, 'Company A', 'PEA', 'internal', 'active', $3, $4),
       ($2, 'Company B', 'PEB', 'internal', 'active', $3, $4)`,
    [companyA, companyB, occurredAt, adminId],
  );
  await owner.query(
    `INSERT INTO company_role_assignment
       (id, user_account_id, company_id, role, unique_grant, created_at, created_by)
     VALUES ($1, $2, $3, 'viewer', 'people-viewer-a', $4, $2)`,
    [viewerGrantId, viewerId, companyA, occurredAt],
  );
  await owner.query(
    `INSERT INTO person
       (id, email, full_name, company_id, status, created_at, created_by)
     VALUES
       ($1, 'ana@example.com', 'Ana A', $3, 'active', $5, $6),
       ($2, 'bea@example.com', 'Bea B', $4, 'active', $5, $6),
       ($7, 'move@example.com', 'Move Person', $3, 'active', $5, $6),
       ($8, 'offboarding@example.com', 'Offboarding Person', $3, 'active', $5, $6),
       ($9, 'inactive-offboarding@example.com', 'Inactive Person', $3, 'active', $5, $6),
       ($10, 'reallocated-offboarding@example.com', 'Reallocated Person', $3, 'active', $5, $6),
       ($11, 'wrong-state@example.com', 'Wrong State Person', $3, 'active', $5, $6),
       ($12, 'no-license@example.com', 'No License Person', $3, 'active', $5, $6),
       ($13, 'rollback-offboarding@example.com', 'Rollback Person', $3, 'active', $5, $6),
       ($14, 'single-move@example.com', 'Single Move Person', $3, 'active', $5, $6),
       ($15, 'ordered@example.com', 'Ordered Person', $3, 'active', $5, $6)`,
    [
      personA,
      personB,
      companyA,
      companyB,
      occurredAt,
      adminId,
      movePersonId,
      offboardingPersonId,
      inactivePersonId,
      reallocatedPersonId,
      wrongStatePersonId,
      noLicensePersonId,
      rollbackPersonId,
      singleMovePersonId,
      orderedPersonId,
    ],
  );
  await owner.query(
    `INSERT INTO vendor
       (id, name, connector_type, provisioning_protocol, can_provision,
        can_deprovision, has_usage_data, has_cost_data, identity_matching,
        status, created_at, created_by)
     VALUES ($1, 'People Vendor', 'orchestration', 'none', false, false,
             true, false, 'email', 'active', $2, $3)`,
    [vendorId, occurredAt, adminId],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
     VALUES
       ($1, $3, 'People Org', 'orchestration', 1, 'active', $4, $5),
       ($2, $3, 'People Org 2', 'orchestration', 1, 'active', $4, $5)`,
    [vendorAccountId, vendorAccountId2, vendorId, occurredAt, adminId],
  );
  await owner.query(
    `INSERT INTO license_type
       (id, vendor_id, name, unit, status, created_at, created_by)
     VALUES
       ($1, $3, 'Enterprise', 'seat', 'active', $4, $5),
       ($2, $3, 'Standard', 'seat', 'active', $4, $5)`,
    [licenseTypeId, licenseTypeId2, vendorId, occurredAt, adminId],
  );
  await owner.query(
    `INSERT INTO license_request
       (id, request_no, person_id, company_id, vendor_account_id,
        license_type_id, state, justification, requested_by, created_at, created_by)
     VALUES
       ($1, 'OFF-LEFT', $2, $8, $10, $11, 'active', 'left', $19, $12, $13),
       ($3, 'OFF-INACTIVE', $4, $8, $10, $11, 'active', 'inactive', $19, $12, $13),
       ($5, 'OFF-REALLOCATED', $6, $8, $10, $11, 'active', 'reallocated', $19, $12, $13),
       ($7, 'OFF-WRONG-STATE', $9, $8, $10, $11, 'approved', 'wrong state', $19, $12, $13),
       ($14, 'OFF-TENANT', $15, $16, $10, $11, 'active', 'tenant B', $19, $12, $13),
       ($17, 'OFF-ROLLBACK', $18, $8, $10, $11, 'active', 'rollback', $19, $12, $13)`,
    [
      offboardingRequestId,
      offboardingPersonId,
      inactiveRequestId,
      inactivePersonId,
      reallocatedRequestId,
      reallocatedPersonId,
      wrongStateRequestId,
      companyA,
      wrongStatePersonId,
      vendorAccountId,
      licenseTypeId,
      occurredAt,
      adminId,
      tenantRequestId,
      personB,
      companyB,
      rollbackRequestId,
      rollbackPersonId,
      viewerId,
    ],
  );
  await owner.query(
    `INSERT INTO license_assignment
       (id, person_id, company_id, vendor_account_id, license_type_id,
        started_on, source_request_id, source_kind, created_at, created_by)
     VALUES
       ($1, $3, $4, $5, $7, '2026-01-01', NULL, 'import', $8, $9),
       ($2, $3, $4, $6, $31, '2026-02-01', NULL, 'import', $8, $9),
       ($10, $11, $4, $5, $7, '2026-03-01', NULL, 'import', $8, $9),
       ($12, $13, $4, $5, $7, '2026-04-01', $14, 'request', $8, $9),
       ($15, $16, $4, $5, $7, '2026-04-02', $17, 'request', $8, $9),
       ($18, $19, $4, $5, $7, '2026-04-03', $20, 'request', $8, $9),
       ($21, $22, $4, $5, $7, '2026-04-04', $23, 'request', $8, $9),
       ($24, $25, $26, $5, $7, '2026-04-05', $27, 'request', $8, $9),
       ($28, $29, $4, $5, $7, '2026-04-06', $30, 'request', $8, $9),
       ($32, $33, $4, $5, $7, '2026-05-01', NULL, 'import', $8, $9),
       ($34, $36, $4, $5, $7, '2026-01-01', NULL, 'import', $8, $9),
       ($35, $36, $4, $6, $31, '2026-02-01', NULL, 'import', $8, $9),
       ($37, $13, $4, $5, $31, '2026-04-07', $14, 'request', $8, $9)`,
    [
      assignmentId,
      assignmentId2,
      movePersonId,
      companyA,
      vendorAccountId,
      vendorAccountId2,
      licenseTypeId,
      occurredAt,
      adminId,
      confirmationAssignmentId,
      personA,
      offboardingAssignmentId,
      offboardingPersonId,
      offboardingRequestId,
      inactiveAssignmentId,
      inactivePersonId,
      inactiveRequestId,
      reallocatedAssignmentId,
      reallocatedPersonId,
      reallocatedRequestId,
      wrongStateAssignmentId,
      wrongStatePersonId,
      wrongStateRequestId,
      tenantAssignmentId,
      personB,
      companyB,
      tenantRequestId,
      rollbackAssignmentId,
      rollbackPersonId,
      rollbackRequestId,
      licenseTypeId2,
      singleMoveAssignmentId,
      singleMovePersonId,
      orderedAssignmentId,
      orderedAssignmentId2,
      orderedPersonId,
      offboardingAssignmentId2,
    ],
  );
  await owner.query(
    `INSERT INTO activity_record
       (id, vendor_account_id, person_id, activity_date, counters, synced_at)
     VALUES
       ($1, $4, $5, '2026-07-19', '{"uses": 1}', '2026-07-20T08:00:00Z'),
       ($2, $4, $5, '2026-07-20', '{"uses": 2}', '2026-07-20T09:00:00Z'),
       ($3, $6, $5, '2026-07-20', '{"uses": 3}', '2026-07-20T10:00:00Z')`,
    [
      orderedActivityId,
      orderedActivityId2,
      orderedActivityId3,
      vendorAccountId,
      orderedPersonId,
      vendorAccountId2,
    ],
  );
  const authorizationRepository = createAuthorizationRepository(
    drizzle(appPool, { schema }),
  );
  const [loadedAdmin, loadedViewer, loadedNoGrant] = await Promise.all([
    authorizationRepository.load({ subject: "people-admin" }),
    authorizationRepository.load({ subject: "people-viewer" }),
    authorizationRepository.load({ subject: "people-nogrant" }),
  ]);
  if (!loadedAdmin || !loadedViewer || !loadedNoGrant) {
    throw new Error("authorization setup failed");
  }
  admin = loadedAdmin;
  viewer = loadedViewer;
  noGrant = loadedNoGrant;
});

afterAll(async () => {
  await appPool?.end();
  await owner?.end();
  await fixture?.stop();
});

describe("people repository", () => {
  test("maps every repository error code to its exact HTTP contract", () => {
    const cases = [
      ["person_forbidden", 403],
      ["person_email_conflict", 409],
      ["company_move_confirmation_required", 422],
      ["person_offboarding_unavailable", 422],
      ["person_request_number_conflict", 422],
      ["person_not_found", 404],
    ] as const;

    expect(
      cases.map(([code, status]) => {
        const error = new PeopleRepositoryError(code);
        return {
          code: error.code,
          message: error.message,
          name: error.name,
          status: error.status,
          expectedStatus: status,
        };
      }),
    ).toEqual(
      cases.map(([code, status]) => ({
        code,
        message: code,
        name: "PeopleRepositoryError",
        status,
        expectedStatus: status,
      })),
    );
  });

  test("normalizes email and relies on the real unique vendor-identity constraint", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }), {
      requestNumber: () => "MOVE-20260727-001",
    });

    const created = await repository.create(admin, {
      fullName: "  Carla C  ",
      email: "  CARLA@EXAMPLE.COM ",
      companyId: companyA,
      status: "active",
      confirmCompanyMove: false,
    }, occurredAt);
    expect(created).toEqual({
      id: expect.any(String),
      fullName: "Carla C",
      email: "carla@example.com",
      companyId: companyA,
      status: "active",
      createdAt: occurredAt,
      createdBy: adminId,
      updatedAt: null,
      updatedBy: null,
    });

    await expect(repository.create(admin, {
      fullName: "Duplicate",
      email: "CARLA@EXAMPLE.COM",
      companyId: companyA,
      status: "active",
      confirmCompanyMove: false,
    }, occurredAt)).rejects.toMatchObject({ code: "person_email_conflict" });

    const updated = await repository.update(admin, {
      id: created.id,
      fullName: "Carla Updated",
      email: created.email,
      companyId: companyA,
      status: "active",
      confirmCompanyMove: false,
    }, occurredAt);
    expect(updated).toEqual({
      closedAssignments: 0,
      createdSuccessors: 0,
      fastTrackRequestId: null,
      fastTrackRequestIds: [],
      reRequestHref: null,
      reRequestHrefs: [],
      person: {
        ...created,
        fullName: "Carla Updated",
        updatedAt: occurredAt,
        updatedBy: adminId,
      },
    });
    const audits = await owner.query(
      `SELECT actor_user_id::text, action, entity_type, entity_id::text,
              company_id::text, note, before, after, occurred_at
         FROM audit_log
        WHERE entity_id = $1 AND action IN ('person.created', 'person.updated')
        ORDER BY action`,
      [created.id],
    );
    expect(audits.rows).toEqual([
      {
        actor_user_id: adminId,
        action: "person.created",
        entity_type: "Person",
        entity_id: created.id,
        company_id: companyA,
        note: null,
        before: null,
        after: {
          fullName: "Carla C",
          email: "carla@example.com",
          companyId: companyA,
          status: "active",
        },
        occurred_at: occurredAt,
      },
      {
        actor_user_id: adminId,
        action: "person.updated",
        entity_type: "Person",
        entity_id: created.id,
        company_id: companyA,
        note: null,
        before: {
          fullName: "Carla C",
          email: "carla@example.com",
          companyId: companyA,
          status: "active",
        },
        after: {
          fullName: "Carla Updated",
          email: "carla@example.com",
          companyId: companyA,
          status: "active",
        },
        occurred_at: occurredAt,
      },
    ]);

  });

  test("authorizes reads by the DB-loaded company grants and hides other tenants", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }));
    const rows = await repository.list(viewer);

    expect(rows.map((row) => row.id)).toContain(personA);
    expect(rows.map((row) => row.id)).not.toContain(personB);
    expect((await repository.list(admin)).map((row) => row.id)).toContain(
      personB,
    );
    const adminRows = await repository.list(admin);
    expect(adminRows.map((row) => row.fullName)).toEqual(
      [...adminRows.map((row) => row.fullName)].sort(),
    );
    expect(
      adminRows.find(({ id }) => id === orderedPersonId),
    ).toEqual({
      id: orderedPersonId,
      fullName: "Ordered Person",
      email: "ordered@example.com",
      companyId: companyA,
      companyName: "Company A",
      status: "active",
      currentLicense: "Enterprise · Standard",
      currentLicenseState: "active",
      lastActiveOn: "2026-07-20",
      freshnessAt: new Date("2026-07-20T10:00:00Z"),
    });
    const moveDetail = await repository.detail(admin, orderedPersonId);
    expect(
      moveDetail.assignmentHistory,
    ).toEqual([
      {
        id: orderedAssignmentId2,
        companyId: companyA,
        companyName: "Company A",
        vendorAccountName: "People Org 2",
        licenseTypeName: "Standard",
        startedOn: "2026-02-01",
        endedOn: null,
        endReason: null,
        sourceKind: "import",
        sourceRequestId: null,
      },
      {
        id: orderedAssignmentId,
        companyId: companyA,
        companyName: "Company A",
        vendorAccountName: "People Org",
        licenseTypeName: "Enterprise",
        startedOn: "2026-01-01",
        endedOn: null,
        endReason: null,
        sourceKind: "import",
        sourceRequestId: null,
      },
    ]);
    expect(moveDetail.activityHistory).toEqual([
      {
        id: orderedActivityId3,
        activityDate: "2026-07-20",
        counters: { uses: 3 },
        syncedAt: new Date("2026-07-20T10:00:00Z"),
      },
      {
        id: orderedActivityId2,
        activityDate: "2026-07-20",
        counters: { uses: 2 },
        syncedAt: new Date("2026-07-20T09:00:00Z"),
      },
      {
        id: orderedActivityId,
        activityDate: "2026-07-19",
        counters: { uses: 1 },
        syncedAt: new Date("2026-07-20T08:00:00Z"),
      },
    ]);
    await expect(repository.list(noGrant)).resolves.toEqual([]);
    await expect(repository.companies(viewer)).resolves.toEqual([
      { id: companyA, name: "Company A" },
    ]);
    await expect(repository.companies(admin)).resolves.toEqual([
      { id: companyA, name: "Company A" },
      { id: companyB, name: "Company B" },
    ]);
    await expect(repository.companies(noGrant)).resolves.toEqual([]);
    await expect(repository.detail(viewer, personB)).rejects.toMatchObject({
      code: "person_not_found",
    });
  });

  test("allows only a group admin to write and never trusts a scoped caller", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }));

    const probeClient = await appPool.connect();
    await probeClient.query("SET statement_timeout = '100ms'");
    const probePid = await probeClient.query(
      "SELECT pg_backend_pid()::int AS pid",
    );
    await owner.query("BEGIN; LOCK TABLE person IN ACCESS EXCLUSIVE MODE");
    try {
      const noAccessRepository = createPeopleRepository(
        drizzle(probeClient, { schema }),
      );
      await expect(noAccessRepository.update(viewer, {
        id: personA,
        fullName: "Must not read",
        email: "ana@example.com",
        companyId: companyA,
        status: "active",
        confirmCompanyMove: false,
      }, occurredAt)).rejects.toMatchObject({ code: "person_forbidden" });
      await expect(noAccessRepository.create(viewer, {
        fullName: "Must not create",
        email: "must-not-create@example.com",
        companyId: companyA,
        status: "active",
        confirmCompanyMove: false,
      }, occurredAt)).rejects.toMatchObject({ code: "person_forbidden" });
      const waiting = await owner.query(
        `SELECT count(*)::int AS count
           FROM pg_locks
          WHERE pid = $1 AND NOT granted`,
        [probePid.rows[0].pid],
      );
      expect(waiting.rows).toEqual([{ count: 0 }]);
    } finally {
      await owner.query("ROLLBACK");
      probeClient.release();
    }

    await expect(repository.update(viewer, {
      id: personA,
      fullName: "Spoofed",
      email: "ana@example.com",
      companyId: companyA,
      status: "active",
      confirmCompanyMove: false,
    }, occurredAt)).rejects.toMatchObject({ code: "person_forbidden" });
    await expect(repository.update(admin, {
      id: "00000000-0000-0000-0000-000000000999",
      fullName: "Missing",
      email: "missing@example.com",
      companyId: companyA,
      status: "active",
      confirmCompanyMove: false,
    }, occurredAt)).rejects.toMatchObject({ code: "person_not_found" });
    await expect(repository.update(viewer, {
      id: personB,
      fullName: "Cross tenant",
      email: "bea@example.com",
      companyId: companyA,
      status: "active",
      confirmCompanyMove: true,
    }, occurredAt)).rejects.toMatchObject({ code: "person_forbidden" });

    const saved = await owner.query(
      `SELECT full_name, company_id::text FROM person WHERE id IN ($1, $2) ORDER BY id`,
      [personA, personB],
    );
    expect(saved.rows).toEqual([
      { full_name: "Ana A", company_id: companyA },
      { full_name: "Bea B", company_id: companyB },
    ]);
  });

  test("starts left-company offboarding with transition, manual removal work, and audit evidence", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }));
    const saved = await startOffboardingWithAuthorization(repository, admin, {
      personId: offboardingPersonId,
      endReason: "left_company",
      note: "Confirmed departure",
    }, occurredAt);

    const action = await owner.query(
      `SELECT id::text, request_id::text, vendor_account_id::text,
              kind, mode, status, raw_request, created_at
         FROM provisioning_action WHERE request_id = $1`,
      [offboardingRequestId],
    );
    expect(action.rows).toHaveLength(1);
    const actionId = action.rows[0].id as string;
    expect(saved).toEqual({
      ok: true,
      personId: offboardingPersonId,
      status: "offboarding",
      affectedRequestIds: [offboardingRequestId],
      provisioningActionIds: [actionId],
    });
    expect(action.rows).toMatchObject([
      {
        id: actionId,
        request_id: offboardingRequestId,
        vendor_account_id: vendorAccountId,
        kind: "checklist",
        mode: "orchestration",
        status: "pending",
        raw_request: {
          checklistSteps: [
            { messageKey: "connector.manual.open_vendor_console" },
            { messageKey: "connector.manual.remove_person" },
            { messageKey: "connector.manual.revoke_license" },
            { messageKey: "connector.manual.confirm_execution" },
          ],
          context: {
            assignmentIds: [
              offboardingAssignmentId,
              offboardingAssignmentId2,
            ],
            endReason: "left_company",
            note: "Confirmed departure",
            personId: offboardingPersonId,
            requestId: offboardingRequestId,
            vendorAccountId,
          },
        },
        created_at: occurredAt,
      },
    ]);
    const persisted = await owner.query(
      `SELECT assignment.id::text AS assignment_id,
              p.status AS person_status, request.state AS request_state,
              assignment.ended_on::text, assignment.end_reason,
              transition.from_state, transition.to_state,
              transition.actor_user_id::text, transition.note,
              transition.occurred_at
         FROM person p
         JOIN license_assignment assignment ON assignment.person_id = p.id
         JOIN license_request request ON request.id = assignment.source_request_id
         JOIN request_transition transition ON transition.request_id = request.id
        WHERE p.id = $1
        ORDER BY assignment.id`,
      [offboardingPersonId],
    );
    expect(persisted.rows).toEqual([
      {
        assignment_id: offboardingAssignmentId,
        person_status: "departed",
        request_state: "offboarding",
        ended_on: null,
        end_reason: null,
        from_state: "active",
        to_state: "offboarding",
        actor_user_id: adminId,
        note: "Confirmed departure",
        occurred_at: occurredAt,
      },
      {
        assignment_id: offboardingAssignmentId2,
        person_status: "departed",
        request_state: "offboarding",
        ended_on: null,
        end_reason: null,
        from_state: "active",
        to_state: "offboarding",
        actor_user_id: adminId,
        note: "Confirmed departure",
        occurred_at: occurredAt,
      },
    ]);
    const audits = await owner.query(
      `SELECT actor_user_id::text, action, entity_type, entity_id::text,
              company_id::text, note, before, after, occurred_at
         FROM audit_log
        WHERE (
          action = 'person.offboarding_started' AND entity_id = $1
        ) OR (
          action = 'request.offboarding' AND entity_id = $2
        )
        ORDER BY action`,
      [offboardingPersonId, offboardingRequestId],
    );
    expect(audits.rows).toEqual([
      {
        actor_user_id: adminId,
        action: "person.offboarding_started",
        entity_type: "Person",
        entity_id: offboardingPersonId,
        company_id: companyA,
        note: "Confirmed departure",
        before: {
          status: "active",
          requestStates: {
            [offboardingRequestId]: "active",
          },
        },
        after: {
          status: "departed",
          requestStates: {
            [offboardingRequestId]: "offboarding",
          },
          provisioningActionIds: [actionId],
        },
        occurred_at: occurredAt,
      },
      {
        actor_user_id: adminId,
        action: "request.offboarding",
        entity_type: "LicenseRequest",
        entity_id: offboardingRequestId,
        company_id: companyA,
        note: "Confirmed departure",
        before: { state: "active" },
        after: { state: "offboarding" },
        occurred_at: occurredAt,
      },
    ]);

    await owner.query(
      `UPDATE provisioning_action
          SET kind = 'invite'
        WHERE request_id = $1`,
      [offboardingRequestId],
    );
    await expect(
      startOffboardingWithAuthorization(repository, admin, {
        personId: offboardingPersonId,
        endReason: "left_company",
        note: "Confirmed departure",
      }, occurredAt),
    ).resolves.toEqual({
      ok: false,
      globalError: "person_offboarding_unavailable",
    });
    await owner.query(
      `UPDATE provisioning_action
          SET kind = 'checklist', mode = 'automated'
        WHERE request_id = $1`,
      [offboardingRequestId],
    );
    await expect(
      startOffboardingWithAuthorization(repository, admin, {
        personId: offboardingPersonId,
        endReason: "left_company",
        note: "Confirmed departure",
      }, occurredAt),
    ).resolves.toEqual({
      ok: false,
      globalError: "person_offboarding_unavailable",
    });
    await owner.query(
      `UPDATE provisioning_action
          SET mode = 'orchestration'
        WHERE request_id = $1`,
      [offboardingRequestId],
    );
    await owner.query(
      `UPDATE provisioning_action
          SET raw_request = jsonb_set(
            raw_request,
            '{operation}',
            '"provision"'::jsonb
          )
        WHERE request_id = $1`,
      [offboardingRequestId],
    );
    await expect(
      startOffboardingWithAuthorization(repository, admin, {
        personId: offboardingPersonId,
        endReason: "left_company",
        note: "Confirmed departure",
      }, occurredAt),
    ).resolves.toEqual({
      ok: false,
      globalError: "person_offboarding_unavailable",
    });
    await owner.query(
      `UPDATE provisioning_action
          SET status = 'sent',
              raw_request = jsonb_set(
                raw_request,
                '{operation}',
                '"deprovision"'::jsonb
              )
        WHERE request_id = $1`,
      [offboardingRequestId],
    );
    await expect(
      startOffboardingWithAuthorization(repository, admin, {
        personId: offboardingPersonId,
        endReason: "left_company",
        note: "Confirmed departure",
      }, occurredAt),
    ).resolves.toEqual({
      ok: false,
      globalError: "person_offboarding_unavailable",
    });
    await expect(
      owner.query(
        `SELECT
           (SELECT count(*)::int FROM provisioning_action
             WHERE request_id = $1) AS actions,
           (SELECT count(*)::int FROM request_transition
             WHERE request_id = $1) AS transitions,
           (SELECT count(*)::int FROM audit_log
             WHERE action = 'person.offboarding_started'
               AND entity_id = $2) AS audits,
           (SELECT state FROM license_request WHERE id = $1) AS request_state,
           (SELECT status FROM person WHERE id = $2) AS person_status`,
        [offboardingRequestId, offboardingPersonId],
      ),
    ).resolves.toMatchObject({
      rows: [{
        actions: 1,
        audits: 1,
        person_status: "departed",
        request_state: "offboarding",
        transitions: 1,
      }],
    });
  });

  test("preserves person status for inactive and reallocated offboarding", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }));
    const inputs = [
      {
        personId: inactivePersonId,
        requestId: inactiveRequestId,
        endReason: "inactive" as const,
      },
      {
        personId: reallocatedPersonId,
        requestId: reallocatedRequestId,
        endReason: "reallocated" as const,
      },
    ];
    for (const input of inputs) {
      const result = await startOffboardingWithAuthorization(
        repository,
        admin,
        {
          personId: input.personId,
          endReason: input.endReason,
          note: `Reason: ${input.endReason}`,
        },
        occurredAt,
      );
      expect(result).toMatchObject({
        ok: true,
        personId: input.personId,
        status: "offboarding",
        affectedRequestIds: [input.requestId],
      });
    }
    const states = await owner.query(
      `SELECT p.id::text, p.status, request.state,
              assignment.ended_on::text,
              count(action.id)::int AS actions
         FROM person p
         JOIN license_assignment assignment ON assignment.person_id = p.id
         JOIN license_request request ON request.id = assignment.source_request_id
         LEFT JOIN provisioning_action action ON action.request_id = request.id
        WHERE p.id IN ($1, $2)
        GROUP BY p.id, p.status, request.state, assignment.ended_on
        ORDER BY p.id`,
      [inactivePersonId, reallocatedPersonId],
    );
    expect(states.rows).toEqual([
      {
        id: inactivePersonId,
        status: "active",
        state: "offboarding",
        ended_on: null,
        actions: 1,
      },
      {
        id: reallocatedPersonId,
        status: "active",
        state: "offboarding",
        ended_on: null,
        actions: 1,
      },
    ]);

    await owner.query(
      `UPDATE provisioning_action
          SET vendor_account_id = $1
        WHERE request_id = $2`,
      [vendorAccountId2, reallocatedRequestId],
    );
    await expect(
      startOffboardingWithAuthorization(repository, admin, {
        personId: reallocatedPersonId,
        endReason: "reallocated",
        note: "Reason: reallocated",
      }, occurredAt),
    ).resolves.toEqual({
      ok: false,
      globalError: "person_offboarding_unavailable",
    });
  });

  test("fails closed for absent, legacy, wrong-state, and unauthorized licenses", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }));
    for (const personId of [
      noLicensePersonId,
      personA,
      wrongStatePersonId,
      "00000000-0000-0000-0000-000000000299",
    ]) {
      await expect(
        startOffboardingWithAuthorization(repository, admin, {
          personId,
          endReason: "inactive",
          note: "Unavailable",
        }, occurredAt),
      ).resolves.toEqual({
        ok: false,
        globalError: "person_offboarding_unavailable",
      });
    }
    await expect(
      startOffboardingWithAuthorization(repository, viewer, {
        personId: personB,
        endReason: "left_company",
        note: "Cross-tenant attempt",
      }, occurredAt),
    ).resolves.toEqual({
      ok: false,
      globalError: "person_forbidden",
    });
    const unchanged = await owner.query(
      `SELECT state FROM license_request WHERE id IN ($1, $2)
       ORDER BY id`,
      [wrongStateRequestId, tenantRequestId],
    );
    expect(unchanged.rows).toEqual([
      { state: "approved" },
      { state: "active" },
    ]);
  });

  test("rolls back request, transition, action, person, and audit when final audit insertion fails", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }));
    await owner.query(`
      CREATE OR REPLACE FUNCTION test_fail_offboarding_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'person.offboarding_started' THEN
          RAISE EXCEPTION 'test: offboarding audit rejected';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_fail_offboarding_audit
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION test_fail_offboarding_audit();
    `);
    try {
      await expect(
        startOffboardingWithAuthorization(repository, admin, {
          personId: rollbackPersonId,
          endReason: "left_company",
          note: "Must roll back",
        }, occurredAt),
      ).resolves.toEqual({
        ok: false,
        globalError: "person_offboarding_failed",
      });
    } finally {
      await owner.query(`
        DROP TRIGGER IF EXISTS test_fail_offboarding_audit ON audit_log;
        DROP FUNCTION IF EXISTS test_fail_offboarding_audit();
      `);
    }
    const state = await owner.query(
      `SELECT p.status,
              request.state,
              assignment.ended_on::text,
              (SELECT count(*)::int FROM request_transition
                WHERE request_id = request.id) AS transitions,
              (SELECT count(*)::int FROM provisioning_action
                WHERE request_id = request.id) AS actions,
              (SELECT count(*)::int FROM audit_log
                WHERE entity_id = p.id
                  AND action = 'person.offboarding_started') AS audits
         FROM person p
         JOIN license_assignment assignment ON assignment.person_id = p.id
         JOIN license_request request ON request.id = assignment.source_request_id
        WHERE p.id = $1`,
      [rollbackPersonId],
    );
    expect(state.rows).toEqual([
      {
        status: "active",
        state: "active",
        ended_on: null,
        transitions: 0,
        actions: 0,
        audits: 0,
      },
    ]);
  });

  test("rejects an unconfirmed company move without writing", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }));

    const unchangedCompany = await repository.update(admin, {
      id: personA,
      fullName: "Ana A",
      email: "ana@example.com",
      companyId: companyA,
      status: "active",
      confirmCompanyMove: false,
    }, occurredAt);
    expect(unchangedCompany).toMatchObject({
      closedAssignments: 0,
      createdSuccessors: 0,
      fastTrackRequestId: null,
    });

    await expect(repository.update(admin, {
      id: personA,
      fullName: "Ana A",
      email: "ana@example.com",
      companyId: companyB,
      status: "active",
      confirmCompanyMove: false,
    }, occurredAt)).rejects.toMatchObject({
      code: "company_move_confirmation_required",
    });

    const state = await owner.query(
      `SELECT
         (SELECT company_id::text FROM person WHERE id = $1) AS person_company,
         (SELECT count(*)::int FROM license_request WHERE person_id = $1) AS requests,
         (SELECT ended_on::text FROM license_assignment WHERE id = $2) AS ended_on`,
      [personA, confirmationAssignmentId],
    );
    expect(state.rows[0]).toEqual({
      person_company: companyA,
      requests: 0,
      ended_on: null,
    });
  });

  test("materializes one coherent fast-track request for one assignment", async () => {
    const repository = createPeopleRepository(drizzle(appPool, { schema }));
    const result = await repository.update(admin, {
      id: singleMovePersonId,
      fullName: "Single Moved",
      email: "single-move@example.com",
      companyId: companyB,
      status: "active",
      confirmCompanyMove: true,
    }, occurredAt);

    expect(result).toEqual({
      person: {
        id: singleMovePersonId,
        fullName: "Single Moved",
        email: "single-move@example.com",
        companyId: companyB,
        status: "active",
        createdAt: occurredAt,
        createdBy: adminId,
        updatedAt: occurredAt,
        updatedBy: adminId,
      },
      closedAssignments: 1,
      createdSuccessors: 1,
      fastTrackRequestId: result.fastTrackRequestId,
      fastTrackRequestIds: [result.fastTrackRequestId],
      reRequestHref: result.reRequestHref,
      reRequestHrefs: [result.reRequestHref],
    });
    expect(result.fastTrackRequestIds).toEqual([
      result.fastTrackRequestId,
    ]);
    expect(result.reRequestHrefs).toEqual([result.reRequestHref]);
    const linkage = await owner.query(
      `SELECT request.request_no,
              request.vendor_account_id::text,
              request.license_type_id::text,
              request.license_assignment_id::text,
              assignment.id::text AS assignment_id,
              assignment.source_request_id::text
         FROM license_request request
         JOIN license_assignment assignment
           ON assignment.id = request.license_assignment_id
        WHERE request.id = $1`,
      [result.fastTrackRequestId],
    );
    expect(linkage.rows).toEqual([
      {
        request_no: expect.stringMatching(
          /^MOVE-20260727-[0-9a-f-]{36}$/,
        ),
        vendor_account_id: vendorAccountId,
        license_type_id: licenseTypeId,
        license_assignment_id: expect.any(String),
        assignment_id: expect.any(String),
        source_request_id: result.fastTrackRequestId,
      },
    ]);
    expect(linkage.rows[0].license_assignment_id).toBe(
      linkage.rows[0].assignment_id,
    );
    const recoveryWork = await owner.query(
      `SELECT source,vendor_account_id::text,license_type_id::text,
              release_event_id::text,
              effective_from::text,status
       FROM capacity_recovery_work
       WHERE vendor_account_id=$1 AND license_type_id=$2 AND source='seat_freed'`,
      [vendorAccountId, licenseTypeId],
    );
    expect(recoveryWork.rows).toEqual([{
      effective_from: "2026-07-27",
      license_type_id: licenseTypeId,
      release_event_id: singleMoveAssignmentId,
      source: "seat_freed",
      status: "pending",
      vendor_account_id: vendorAccountId,
    }]);
  });

  test("moves a person and materializes contiguous register lineage atomically", async () => {
    const failingRepository = createPeopleRepository(drizzle(appPool, {
      schema,
    }), {
      requestNumber: (_date, index) =>
        `MOVE-20260727-ROLLBACK-${index}`,
    });
    const auditsBefore = await owner.query(
      "SELECT count(*)::int AS count FROM audit_log",
    );
    const recoveryBefore = await owner.query(
      "SELECT count(*)::int AS count FROM capacity_recovery_work",
    );
    await owner.query(`
      CREATE OR REPLACE FUNCTION test_fail_person_move_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'person.company_moved' THEN
          RAISE EXCEPTION 'test: final person audit rejected';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_fail_person_move_audit
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION test_fail_person_move_audit();
    `);
    try {
      await expect(failingRepository.update(admin, {
        id: movePersonId,
        fullName: "Must Roll Back",
        email: "move@example.com",
        companyId: companyB,
        status: "active",
        confirmCompanyMove: true,
      }, occurredAt)).rejects.toThrow("test: final person audit rejected");
    } finally {
      await owner.query(`
        DROP TRIGGER IF EXISTS test_fail_person_move_audit ON audit_log;
        DROP FUNCTION IF EXISTS test_fail_person_move_audit();
      `);
    }
    const rolledBack = await owner.query(
      `SELECT
         (SELECT full_name FROM person WHERE id = $1) AS full_name,
         (SELECT company_id::text FROM person WHERE id = $1) AS company_id,
         (SELECT count(*)::int FROM license_request
            WHERE person_id = $1) AS requests,
         (SELECT count(*)::int
            FROM request_transition transition
            JOIN license_request request ON request.id = transition.request_id
            WHERE request.person_id = $1) AS transitions,
         (SELECT count(*)::int FROM license_assignment
            WHERE person_id = $1
              AND source_kind = 'request') AS successors,
         (SELECT count(*)::int FROM capacity_recovery_work) AS recovery_work,
         (SELECT count(*)::int FROM audit_log) AS audits`,
      [movePersonId],
    );
    expect(rolledBack.rows[0]).toEqual({
      full_name: "Move Person",
      company_id: companyA,
      requests: 0,
      transitions: 0,
      successors: 0,
      recovery_work: recoveryBefore.rows[0].count,
      audits: auditsBefore.rows[0].count,
    });
    const originalAssignments = await owner.query(
      `SELECT id::text, company_id::text, started_on::text, ended_on::text,
              end_reason, source_kind, source_request_id::text
         FROM license_assignment
        WHERE id IN ($1, $2)
        ORDER BY id`,
      [assignmentId, assignmentId2],
    );
    expect(originalAssignments.rows).toEqual([
      {
        id: assignmentId,
        company_id: companyA,
        started_on: "2026-01-01",
        ended_on: null,
        end_reason: null,
        source_kind: "import",
        source_request_id: null,
      },
      {
        id: assignmentId2,
        company_id: companyA,
        started_on: "2026-02-01",
        ended_on: null,
        end_reason: null,
        source_kind: "import",
        source_request_id: null,
      },
    ]);

    const collidingRepository = createPeopleRepository(
      drizzle(appPool, { schema }),
      { requestNumber: () => "MOVE-FORCED-COLLISION" },
    );
    await expect(
      collidingRepository.update(admin, {
        id: movePersonId,
        fullName: "Collision must roll back",
        email: "move@example.com",
        companyId: companyB,
        status: "active",
        confirmCompanyMove: true,
      }, occurredAt),
    ).rejects.toMatchObject({
      code: "person_request_number_conflict",
    });
    const afterCollision = await owner.query(
      `SELECT
         (SELECT company_id::text FROM person WHERE id = $1) AS company_id,
         (SELECT count(*)::int FROM license_request
            WHERE person_id = $1) AS requests,
         (SELECT count(*)::int FROM license_assignment
            WHERE person_id = $1 AND source_kind = 'request') AS successors`,
      [movePersonId],
    );
    expect(afterCollision.rows).toEqual([
      { company_id: companyA, requests: 0, successors: 0 },
    ]);

    const repository = createPeopleRepository(drizzle(appPool, { schema }), {
      requestNumber: (_date, index) =>
        `MOVE-20260727-002-${index}`,
    });
    await owner.query(`
      CREATE OR REPLACE FUNCTION test_pause_person_move()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.person_id = '${movePersonId}'::uuid THEN
          PERFORM pg_advisory_xact_lock(1010);
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_pause_person_move
        BEFORE INSERT ON license_request
        FOR EACH ROW EXECUTE FUNCTION test_pause_person_move();
      SELECT pg_advisory_lock(1010);
    `);
    let result;
    let offboarding;
    try {
      const movePromise = repository.update(admin, {
        id: movePersonId,
        fullName: "Ana Moved",
        email: "move@example.com",
        companyId: companyB,
        status: "active",
        confirmCompanyMove: true,
      }, occurredAt);
      await waitForLockWaiters(owner, 1);
      const offboardingPromise = repository.startOffboarding(admin, {
        personId: movePersonId,
        endReason: "inactive",
        note: "Move cleanup",
      }, occurredAt);
      await waitForLockWaiters(owner, 2);
      await owner.query("SELECT pg_advisory_unlock(1010)");
      [result, offboarding] = await Promise.all([
        movePromise,
        offboardingPromise,
      ]);
    } finally {
      await owner.query(`
        SELECT pg_advisory_unlock_all();
        DROP TRIGGER IF EXISTS test_pause_person_move ON license_request;
        DROP FUNCTION IF EXISTS test_pause_person_move();
      `);
    }

    expect(result).toEqual({
      person: {
        id: movePersonId,
        fullName: "Ana Moved",
        email: "move@example.com",
        companyId: companyB,
        status: "active",
        createdAt: occurredAt,
        createdBy: adminId,
        updatedAt: occurredAt,
        updatedBy: adminId,
      },
      closedAssignments: 2,
      createdSuccessors: 2,
      fastTrackRequestId: result.fastTrackRequestIds[0],
      fastTrackRequestIds: result.fastTrackRequestIds,
      reRequestHref: result.reRequestHrefs[0],
      reRequestHrefs: result.reRequestHrefs,
    });
    expect(result.fastTrackRequestIds).toHaveLength(2);
    expect(result.reRequestHrefs).toEqual(
      result.fastTrackRequestIds.map((id) => `/solicitudes/${id}`),
    );
    const closed = await owner.query(
      `SELECT id::text, company_id::text, started_on::text, ended_on::text,
              end_reason
         FROM license_assignment
        WHERE id IN ($1, $2)
        ORDER BY id`,
      [assignmentId, assignmentId2],
    );
    expect(closed.rows).toEqual([
      {
        id: assignmentId,
        company_id: companyA,
        started_on: "2026-01-01",
        ended_on: "2026-07-26",
        end_reason: "reallocated",
      },
      {
        id: assignmentId2,
        company_id: companyA,
        started_on: "2026-02-01",
        ended_on: "2026-07-26",
        end_reason: "reallocated",
      },
    ]);
    const successors = await owner.query(
      `SELECT assignment.id::text, assignment.company_id::text,
              assignment.vendor_account_id::text,
              assignment.license_type_id::text,
              assignment.started_on::text, assignment.ended_on::text,
              assignment.end_reason, assignment.source_kind,
              assignment.source_request_id::text, assignment.note,
              request.vendor_account_id::text AS request_vendor_account_id,
              request.license_type_id::text AS request_license_type_id,
              request.license_assignment_id::text
         FROM license_assignment assignment
         JOIN license_request request
           ON request.id = assignment.source_request_id
        WHERE assignment.person_id = $1
          AND assignment.source_kind = 'request'
        ORDER BY assignment.vendor_account_id`,
      [movePersonId],
    );
    expect(successors.rows).toEqual([
      {
        id: expect.any(String),
        company_id: companyB,
        vendor_account_id: vendorAccountId,
        license_type_id: licenseTypeId,
        started_on: "2026-07-27",
        ended_on: null,
        end_reason: null,
        source_kind: "request",
        source_request_id: expect.any(String),
        note: "cambio de compañía",
        request_vendor_account_id: vendorAccountId,
        request_license_type_id: licenseTypeId,
        license_assignment_id: expect.any(String),
      },
      {
        id: expect.any(String),
        company_id: companyB,
        vendor_account_id: vendorAccountId2,
        license_type_id: licenseTypeId2,
        started_on: "2026-07-27",
        ended_on: null,
        end_reason: null,
        source_kind: "request",
        source_request_id: expect.any(String),
        note: "cambio de compañía",
        request_vendor_account_id: vendorAccountId2,
        request_license_type_id: licenseTypeId2,
        license_assignment_id: expect.any(String),
      },
    ]);
    expect(
      successors.rows.map(({ id }) => id),
    ).toEqual(successors.rows.map(({ license_assignment_id }) => license_assignment_id));
    expect(
      successors.rows.map(({ source_request_id }) => source_request_id).sort(),
    ).toEqual(result.fastTrackRequestIds);
    expect(successors.rows).toHaveLength(2);
    const transition = await owner.query(
      `SELECT from_state, to_state, note
         FROM request_transition WHERE request_id = ANY($1::uuid[])
          AND from_state IS NULL
         ORDER BY request_id`,
      [result.fastTrackRequestIds],
    );
    expect(transition.rows).toEqual([
      {
        from_state: null,
        to_state: "active",
        note: "cambio de compañía",
      },
      {
        from_state: null,
        to_state: "active",
        note: "cambio de compañía",
      },
    ]);
    const moveAudits = await owner.query(
      `SELECT actor_user_id::text, action, entity_type, entity_id::text,
              company_id::text, note, before, after, occurred_at
         FROM audit_log
        WHERE action IN (
          'license_request.fast_track_materialized',
          'license_assignment.reallocated',
          'license_assignment.successor_created',
          'person.company_moved'
        )
          AND (
            entity_id = $1
            OR entity_id = ANY($2::uuid[])
            OR entity_id = ANY($3::uuid[])
            OR entity_id = ANY($4::uuid[])
          )`,
      [
        movePersonId,
        result.fastTrackRequestIds,
        [assignmentId, assignmentId2],
        successors.rows.map(({ id }) => id),
      ],
    );
    expect(moveAudits.rows).toHaveLength(7);
    expect(moveAudits.rows).toEqual(
      expect.arrayContaining([
        {
          actor_user_id: adminId,
          action: "person.company_moved",
          entity_type: "Person",
          entity_id: movePersonId,
          company_id: companyB,
          note: "cambio de compañía",
          before: {
            fullName: "Move Person",
            email: "move@example.com",
            companyId: companyA,
            status: "active",
          },
          after: {
            fullName: "Ana Moved",
            email: "move@example.com",
            companyId: companyB,
            status: "active",
          },
          occurred_at: occurredAt,
        },
        ...result.fastTrackRequestIds.map((requestId) => ({
          actor_user_id: adminId,
          action: "license_request.fast_track_materialized",
          entity_type: "LicenseRequest",
          entity_id: requestId,
          company_id: companyB,
          note: "cambio de compañía",
          before: { state: null },
          after: { state: "active" },
          occurred_at: occurredAt,
        })),
        ...[assignmentId, assignmentId2].map((id) => ({
          actor_user_id: adminId,
          action: "license_assignment.reallocated",
          entity_type: "LicenseAssignment",
          entity_id: id,
          company_id: companyA,
          note: "cambio de compañía",
          before: { endedOn: null, endReason: null },
          after: {
            endedOn: "2026-07-26",
            endReason: "reallocated",
          },
          occurred_at: occurredAt,
        })),
        ...successors.rows.map((row) => ({
          actor_user_id: adminId,
          action: "license_assignment.successor_created",
          entity_type: "LicenseAssignment",
          entity_id: row.id,
          company_id: companyB,
          note: "cambio de compañía",
          before: null,
          after: {
            startedOn: "2026-07-27",
            sourceKind: "request",
            sourceRequestId: row.source_request_id,
          },
          occurred_at: occurredAt,
        })),
      ]),
    );

    expect(offboarding.affectedRequestIds).toEqual(
      result.fastTrackRequestIds,
    );
    const removals = await owner.query(
      `SELECT id::text, request_id::text, vendor_account_id::text,
              kind, mode, status, raw_request
         FROM provisioning_action
        WHERE request_id = ANY($1::uuid[])
        ORDER BY request_id`,
      [result.fastTrackRequestIds],
    );
    expect(removals.rows).toHaveLength(successors.rows.length);
    for (const row of successors.rows) {
      expect(
        removals.rows.find(
          (removal) => removal.request_id === row.source_request_id,
        ),
      ).toMatchObject({
        id: expect.any(String),
        request_id: row.source_request_id,
        vendor_account_id: row.vendor_account_id,
        kind: "checklist",
        mode: "orchestration",
        status: "pending",
        raw_request: {
          checklistSteps: [
            { messageKey: "connector.manual.open_vendor_console" },
            { messageKey: "connector.manual.remove_person" },
            { messageKey: "connector.manual.revoke_license" },
            { messageKey: "connector.manual.confirm_execution" },
          ],
          context: {
            assignmentIds: [row.id],
            endReason: "inactive",
            note: "Move cleanup",
            personId: movePersonId,
            requestId: row.source_request_id,
            vendorAccountId: row.vendor_account_id,
          },
          operation: "deprovision",
          version: 1,
        },
      });
    }
    expect(
      removals.rows.map(({ id }) => id).sort(),
    ).toEqual([...offboarding.provisioningActionIds].sort());

    await owner.query(
      `UPDATE provisioning_action
          SET raw_request = jsonb_set(
            raw_request,
            '{operation}',
            '"provision"'::jsonb
          )
        WHERE id = $1`,
      [offboarding.provisioningActionIds[0]],
    );
    await expect(
      repository.startOffboarding(admin, {
        personId: movePersonId,
        endReason: "inactive",
        note: "Move cleanup",
      }, occurredAt),
    ).rejects.toMatchObject({
      code: "person_offboarding_unavailable",
    });
    await owner.query(
      `UPDATE provisioning_action
          SET raw_request = jsonb_set(
            raw_request,
            '{operation}',
            '"deprovision"'::jsonb
          )
        WHERE id = $1`,
      [offboarding.provisioningActionIds[0]],
    );
    await owner.query(
      "UPDATE provisioning_action SET raw_request = NULL WHERE id = $1",
      [offboarding.provisioningActionIds[1]],
    );
    await expect(
      repository.startOffboarding(admin, {
        personId: movePersonId,
        endReason: "inactive",
        note: "Move cleanup",
      }, occurredAt),
    ).rejects.toMatchObject({
      code: "person_offboarding_unavailable",
    });
    await owner.query(
      "UPDATE provisioning_action SET raw_request = $2::jsonb WHERE id = $1",
      [
        offboarding.provisioningActionIds[1],
        removals.rows.find(
          ({ id }) => id === offboarding.provisioningActionIds[1],
        )?.raw_request,
      ],
    );
    const replay = await repository.startOffboarding(admin, {
      personId: movePersonId,
      endReason: "inactive",
      note: "Move cleanup",
    }, occurredAt);
    expect(replay).toEqual(offboarding);
    const actionCount = await owner.query(
      `SELECT count(*)::int AS count FROM provisioning_action
        WHERE request_id = ANY($1::uuid[])`,
      [result.fastTrackRequestIds],
    );
    expect(actionCount.rows).toEqual([{ count: 2 }]);
    const replayAudits = await owner.query(
      `SELECT actor_user_id::text, action, entity_type, entity_id::text,
              company_id::text, note, before, after, occurred_at
         FROM audit_log
        WHERE action = 'person.offboarding_started' AND entity_id = $1`,
      [movePersonId],
    );
    const requestStatesActive = Object.fromEntries(
      result.fastTrackRequestIds.map((id) => [id, "active"]),
    );
    const requestStatesOffboarding = Object.fromEntries(
      result.fastTrackRequestIds.map((id) => [id, "offboarding"]),
    );
    const commonAudit = {
      actor_user_id: adminId,
      action: "person.offboarding_started",
      entity_type: "Person",
      entity_id: movePersonId,
      company_id: companyB,
      note: "Move cleanup",
      occurred_at: occurredAt,
    };
    expect(replayAudits.rows).toHaveLength(2);
    expect(replayAudits.rows).toEqual(
      expect.arrayContaining([
        {
          ...commonAudit,
          before: {
            status: "active",
            requestStates: requestStatesActive,
          },
          after: {
            status: "active",
            requestStates: requestStatesOffboarding,
            provisioningActionIds: offboarding.provisioningActionIds,
          },
        },
        {
          ...commonAudit,
          before: {
            status: "active",
            requestStates: requestStatesOffboarding,
          },
          after: {
            status: "active",
            requestStates: requestStatesOffboarding,
            provisioningActionIds: offboarding.provisioningActionIds,
          },
        },
      ]),
    );

    await owner.query(
      `UPDATE license_request
          SET state = 'active'
        WHERE id = $1`,
      [result.fastTrackRequestIds[0]],
    );
    await expect(
      repository.startOffboarding(admin, {
        personId: movePersonId,
        endReason: "inactive",
        note: "Move cleanup",
      }, occurredAt),
    ).rejects.toMatchObject({
      code: "person_offboarding_unavailable",
    });
  });

});
