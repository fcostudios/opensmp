import { afterEach, describe, expect, test } from "vitest";
import type pg from "pg";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "../testing/postgres-container";

const fixtures: PostgresFixture[] = [];

const ids = {
  alertEvent: "00000000-0000-0000-0000-000000000101",
  alertRule: "00000000-0000-0000-0000-000000000102",
  companyA: "00000000-0000-0000-0000-000000000103",
  companyB: "00000000-0000-0000-0000-000000000104",
  licenseRequestA: "00000000-0000-0000-0000-000000000105",
  licenseRequestB: "00000000-0000-0000-0000-000000000106",
  licenseType: "00000000-0000-0000-0000-000000000107",
  person: "00000000-0000-0000-0000-000000000108",
  provisioningAction: "00000000-0000-0000-0000-000000000109",
  vendor: "00000000-0000-0000-0000-000000000110",
  vendorAccount: "00000000-0000-0000-0000-000000000111",
} as const;

const systemUserId = "00000000-0000-0000-0000-000000000001";

async function seedRegisterFixture(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO company (id, name, code, type, status, created_at, created_by)
     VALUES ($1, 'Company A', 'COMP-A', 'internal', 'active', now(), $2),
            ($3, 'Company B', 'COMP-B', 'internal', 'active', now(), $2)`,
    [ids.companyA, systemUserId, ids.companyB],
  );
  await client.query(
    `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
     VALUES ($1, 'register.person@example.test', 'Register Person', $2, 'active', now(), $3)`,
    [ids.person, ids.companyA, systemUserId],
  );
  await client.query(
    `INSERT INTO vendor (id, name, connector_type, provisioning_protocol, can_provision,
       can_deprovision, has_usage_data, has_cost_data, identity_matching, status, created_at, created_by)
     VALUES ($1, 'Vendor', 'api', 'rest', true, true, true, true, 'email', 'active', now(), $2)`,
    [ids.vendor, systemUserId],
  );
  await client.query(
    `INSERT INTO vendor_account (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
     VALUES ($1, $2, 'Vendor Account', 'automated', 0, 'active', now(), $3)`,
    [ids.vendorAccount, ids.vendor, systemUserId],
  );
  await client.query(
    `INSERT INTO license_type (id, vendor_id, name, unit, status, created_at, created_by)
     VALUES ($1, $2, 'Seat', 'seat', 'active', now(), $3)`,
    [ids.licenseType, ids.vendor, systemUserId],
  );
  await client.query(
    `INSERT INTO license_request (id, request_no, person_id, company_id, vendor_account_id,
       license_type_id, state, justification, created_at, created_by)
     VALUES ($1, 'REQ-001', $3, $4, $5, $6, 'active', 'fixture', now(), $2),
            ($7, 'REQ-002', $3, $4, $5, $6, 'active', 'fixture', now(), $2)`,
    [
      ids.licenseRequestA,
      systemUserId,
      ids.person,
      ids.companyA,
      ids.vendorAccount,
      ids.licenseType,
      ids.licenseRequestB,
    ],
  );
}

async function insertAssignment(
  client: pg.Client,
  {
    id,
    companyId = ids.companyA,
    endedOn = null,
    endReason = null,
    sourceRequestId = null,
    startedOn,
  }: {
    id: string;
    companyId?: string;
    endedOn?: string | null;
    endReason?: "inactive" | "left_company" | "reallocated" | null;
    sourceRequestId?: string | null;
    startedOn: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO license_assignment (
       id, person_id, company_id, vendor_account_id, license_type_id, started_on,
       ended_on, end_reason, source_request_id, source_kind, created_at, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'import', now(), $10)`,
    [
      id,
      ids.person,
      companyId,
      ids.vendorAccount,
      ids.licenseType,
      startedOn,
      endedOn,
      endReason,
      sourceRequestId,
      systemUserId,
    ],
  );
}

async function connectAsRuntimeApp(fixture: PostgresFixture): Promise<pg.Client> {
  const app = await fixture.connectAsApp();
  const identity = await app.query<{ current_user: string }>("SELECT current_user");
  expect(identity.rows).toEqual([{ current_user: "ledger_app" }]);
  return app;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

describe("US-003 register integrity migration", () => {
  test("installs the no-overlap exclusion and one-pending-proposal constraints", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    try {
      const constraints = await owner.query<{ name: string }>(`
        SELECT constraint_row.conname AS name
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.license_assignment'::regclass
        ORDER BY constraint_row.conname
      `);
      const indexes = await owner.query<{ name: string }>(`
        SELECT index_row.relname AS name
        FROM pg_index AS index_definition
        JOIN pg_class AS index_row ON index_row.oid = index_definition.indexrelid
        WHERE index_definition.indrelid = 'public.reclamation_proposal'::regclass
          AND index_row.relname = 'reclamation_proposal_one_pending_per_assignment'
      `);

      expect(constraints.rows.map((row) => row.name)).toContain(
        "license_assignment_no_overlap",
      );
      expect(indexes.rows).toEqual([
        { name: "reclamation_proposal_one_pending_per_assignment" },
      ]);
    } finally {
      await owner.end();
    }
  }, 150_000);

  test("rejects an overlapping attribution even when its company_id differs", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await connectAsRuntimeApp(fixture);
    try {
      await seedRegisterFixture(owner);
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000201",
        endedOn: "2026-01-31",
        startedOn: "2026-01-01",
      });

      await expect(
        insertAssignment(app, {
          companyId: ids.companyB,
          id: "00000000-0000-0000-0000-000000000202",
          startedOn: "2026-01-31",
        }),
      ).rejects.toMatchObject({
        code: "23P01",
        constraint: "license_assignment_no_overlap",
      });
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("allows an adjacent assignment after an inclusive end date", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await connectAsRuntimeApp(fixture);
    try {
      await seedRegisterFixture(owner);
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000203",
        endedOn: "2026-01-31",
        startedOn: "2026-01-01",
      });
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000204",
        startedOn: "2026-02-01",
      });

      const result = await app.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM license_assignment",
      );
      expect(result.rows).toEqual([{ count: "2" }]);
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("rejects a reallocation close without a contiguous successor at commit", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await connectAsRuntimeApp(fixture);
    try {
      await seedRegisterFixture(owner);
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000205",
        startedOn: "2026-01-01",
      });
      await app.query("BEGIN");
      await app.query(
        "UPDATE license_assignment SET ended_on = '2026-01-31', end_reason = 'reallocated' WHERE id = $1",
        ["00000000-0000-0000-0000-000000000205"],
      );
      await expect(app.query("COMMIT")).rejects.toMatchObject({
        code: "23514",
        constraint: "license_assignment_reallocation_contiguous",
      });
      await app.query("ROLLBACK").catch(() => undefined);
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("rejects a reallocation successor separated by a one-day gap", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await connectAsRuntimeApp(fixture);
    try {
      await seedRegisterFixture(owner);
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000212",
        startedOn: "2026-01-01",
      });
      await app.query("BEGIN");
      await app.query(
        "UPDATE license_assignment SET ended_on = '2026-01-31', end_reason = 'reallocated' WHERE id = $1",
        ["00000000-0000-0000-0000-000000000212"],
      );
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000213",
        startedOn: "2026-02-02",
      });
      await expect(app.query("COMMIT")).rejects.toMatchObject({
        code: "23514",
        constraint: "license_assignment_reallocation_contiguous",
      });
      await app.query("ROLLBACK").catch(() => undefined);
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("ignores an app-created temp table when checking reallocation contiguity", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await connectAsRuntimeApp(fixture);
    try {
      await seedRegisterFixture(owner);
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000214",
        startedOn: "2026-01-01",
      });
      await app.query(`
        CREATE TEMP TABLE license_assignment (
          id uuid,
          person_id uuid,
          vendor_account_id uuid,
          license_type_id uuid,
          started_on date
        )
      `);
      await app.query(
        `INSERT INTO license_assignment (id, person_id, vendor_account_id, license_type_id, started_on)
         VALUES ('00000000-0000-0000-0000-000000000215', $1, $2, $3, '2026-02-01')`,
        [ids.person, ids.vendorAccount, ids.licenseType],
      );
      await app.query("BEGIN");
      await app.query("SET LOCAL search_path = pg_temp, public");
      await app.query(
        "UPDATE public.license_assignment SET ended_on = '2026-01-31', end_reason = 'reallocated' WHERE id = $1",
        ["00000000-0000-0000-0000-000000000214"],
      );
      await expect(app.query("COMMIT")).rejects.toMatchObject({
        code: "23514",
        constraint: "license_assignment_reallocation_contiguous",
      });
      await app.query("ROLLBACK").catch(() => undefined);
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("accepts a reallocation and successor committed in the same transaction", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await connectAsRuntimeApp(fixture);
    try {
      await seedRegisterFixture(owner);
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000206",
        startedOn: "2026-01-01",
      });
      await app.query("BEGIN");
      await app.query(
        "UPDATE license_assignment SET ended_on = '2026-01-31', end_reason = 'reallocated' WHERE id = $1",
        ["00000000-0000-0000-0000-000000000206"],
      );
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000207",
        startedOn: "2026-02-01",
      });
      await app.query("COMMIT");

      const result = await app.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM license_assignment",
      );
      expect(result.rows).toEqual([{ count: "2" }]);
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("rejects duplicate pending proposals and allows one request to materialize multiple assignments", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await connectAsRuntimeApp(fixture);
    try {
      await seedRegisterFixture(owner);
      await insertAssignment(app, {
        endedOn: "2026-01-31",
        id: "00000000-0000-0000-0000-000000000208",
        sourceRequestId: ids.licenseRequestA,
        startedOn: "2026-01-01",
      });
      await app.query(
        `INSERT INTO reclamation_proposal (id, assignment_id, status, created_at)
         VALUES ('00000000-0000-0000-0000-000000000209', $1, 'pending', now())`,
        ["00000000-0000-0000-0000-000000000208"],
      );
      await expect(
        app.query(
          `INSERT INTO reclamation_proposal (id, assignment_id, status, created_at)
           VALUES ('00000000-0000-0000-0000-000000000210', $1, 'pending', now())`,
          ["00000000-0000-0000-0000-000000000208"],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "reclamation_proposal_one_pending_per_assignment",
      });
      await app.query(
        `INSERT INTO reclamation_proposal (id, assignment_id, status, created_at)
         VALUES ('00000000-0000-0000-0000-000000000216', $1, 'dismissed', now()),
                ('00000000-0000-0000-0000-000000000217', $1, 'dismissed', now())`,
        ["00000000-0000-0000-0000-000000000208"],
      );
      const proposals = await app.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM reclamation_proposal WHERE assignment_id = $1",
        ["00000000-0000-0000-0000-000000000208"],
      );
      expect(proposals.rows).toEqual([{ count: "3" }]);
      await insertAssignment(app, {
        id: "00000000-0000-0000-0000-000000000211",
        sourceRequestId: ids.licenseRequestA,
        startedOn: "2026-02-01",
      });
      const materializations = await app.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM license_assignment
         WHERE source_request_id = $1`,
        [ids.licenseRequestA],
      );
      expect(materializations.rows).toEqual([{ count: "2" }]);
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);
});
