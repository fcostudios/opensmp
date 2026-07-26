import { afterEach, describe, expect, test } from "vitest";
import type pg from "pg";
import { deleteCompanyRoleAssignmentWithAudit } from "./company-role-assignment-mutations";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "./testing/postgres-container";

const fixtures: PostgresFixture[] = [];
const systemUserId = "00000000-0000-0000-0000-000000000001";
const companyId = "00000000-0000-0000-0000-000000000401";
const otherCompanyId = "00000000-0000-0000-0000-000000000499";
type QueryClient = Pick<pg.Client, "query">;

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

async function createGrant(
  client: QueryClient,
  id: string,
  uniqueGrant: string,
  role: "approver" | "finance" | "viewer" = "viewer",
): Promise<void> {
  await client.query(
    `INSERT INTO public.company_role_assignment (
       id, user_account_id, company_id, role, unique_grant, created_at, created_by
     ) VALUES ($1, $2, $3, $4, $5, now(), $2)`,
    [id, systemUserId, companyId, role, uniqueGrant],
  );
}

async function seedCompany(client: QueryClient): Promise<void> {
  await client.query(
    `INSERT INTO public.company (id, name, code, type, status, created_at, created_by)
     VALUES ($1, 'Mutation Company', 'COMP-MUTATION', 'internal', 'active', now(), $2)`,
    [companyId, systemUserId],
  );
}

describe("CompanyRoleAssignment revoke mutation", () => {
  test("does not revoke or audit a grant when its company scope does not match", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const grantId = "00000000-0000-0000-0000-000000000405";
    try {
      await seedCompany(owner);
      await createGrant(owner, grantId, "grant-cross-company");

      await expect(
        deleteCompanyRoleAssignmentWithAudit(app, {
          actorUserId: systemUserId,
          assignmentId: grantId,
          companyId: otherCompanyId,
        }),
      ).resolves.toBeNull();
      await expect(
        owner.query("SELECT id FROM public.company_role_assignment WHERE id = $1", [grantId]),
      ).resolves.toMatchObject({ rows: [{ id: grantId }] });
      await expect(
        owner.query("SELECT entity_id FROM public.audit_log WHERE entity_id = $1", [grantId]),
      ).resolves.toMatchObject({ rows: [] });
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("revokes through the app role and records the immutable before-state", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const grantId = "00000000-0000-0000-0000-000000000402";
    try {
      await seedCompany(owner);
      await createGrant(owner, grantId, "grant-success");

      const deleted = await deleteCompanyRoleAssignmentWithAudit(app, {
        actorUserId: systemUserId,
        assignmentId: grantId,
        companyId,
      });
      const state = await owner.query<{
        after: unknown;
        before: { id: string; unique_grant: string };
        company_id: string;
        entity_id: string;
      }>(`
        SELECT before, after, company_id, entity_id
        FROM public.audit_log
        WHERE action = 'company_role_assignment.revoked'
      `);

      expect(deleted).toMatchObject({ id: grantId, unique_grant: "grant-success" });
      expect(state.rows).toEqual([
        {
          after: null,
          before: expect.objectContaining({ id: grantId, unique_grant: "grant-success" }),
          company_id: companyId,
          entity_id: grantId,
        },
      ]);
      await expect(
        owner.query("SELECT id FROM public.company_role_assignment WHERE id = $1", [grantId]),
      ).resolves.toMatchObject({ rows: [] });
      await expect(
        app.query("DELETE FROM public.company_role_assignment WHERE id = $1", [grantId]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("does not commit a caller-owned outer transaction", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const grantId = "00000000-0000-0000-0000-000000000406";
    const outerGrantId = "00000000-0000-0000-0000-000000000407";
    try {
      await seedCompany(owner);
      await createGrant(owner, grantId, "grant-owned-transaction");
      await app.query("BEGIN");
      await createGrant(app, outerGrantId, "grant-uncommitted-caller-state", "approver");

      await expect(
        deleteCompanyRoleAssignmentWithAudit(app, {
          actorUserId: systemUserId,
          assignmentId: grantId,
          companyId,
        }),
      ).resolves.toMatchObject({ id: grantId });
      await expect(
        owner.query(
          "SELECT id FROM public.company_role_assignment WHERE id = ANY($1::uuid[]) ORDER BY id",
          [[grantId, outerGrantId]],
        ),
      ).resolves.toMatchObject({ rows: [{ id: grantId }] });

      await app.query("COMMIT");
      await expect(
        owner.query(
          "SELECT id FROM public.company_role_assignment WHERE id = ANY($1::uuid[]) ORDER BY id",
          [[grantId, outerGrantId]],
        ),
      ).resolves.toMatchObject({ rows: [{ id: outerGrantId }] });
    } finally {
      await app.query("ROLLBACK").catch(() => undefined);
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("ignores temporary shadow tables when revoking and auditing", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const grantId = "00000000-0000-0000-0000-000000000408";
    try {
      await seedCompany(owner);
      await createGrant(owner, grantId, "grant-public-shadowed");
      await app.query(`
        CREATE TEMP TABLE company_role_assignment (
          id uuid,
          user_account_id uuid,
          company_id uuid,
          role text,
          unique_grant text
        );
        INSERT INTO company_role_assignment
          VALUES ('${grantId}', '${systemUserId}', '${companyId}', 'viewer', 'shadowed-grant');
        CREATE TEMP TABLE audit_log (
          actor_user_id uuid,
          action text,
          entity_type text,
          entity_id uuid,
          company_id uuid,
          note text,
          before jsonb,
          after jsonb,
          occurred_at timestamptz
        );
      `);

      await expect(
        deleteCompanyRoleAssignmentWithAudit(app, {
          actorUserId: systemUserId,
          assignmentId: grantId,
          companyId,
        }),
      ).resolves.toMatchObject({ id: grantId, unique_grant: "grant-public-shadowed" });
      await expect(
        owner.query("SELECT id FROM public.company_role_assignment WHERE id = $1", [grantId]),
      ).resolves.toMatchObject({ rows: [] });
      await expect(
        owner.query(
          "SELECT entity_id FROM public.audit_log WHERE action = 'company_role_assignment.revoked'",
        ),
      ).resolves.toMatchObject({ rows: [{ entity_id: grantId }] });
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("rolls back the audit insertion when a protected delete is skipped", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const grantId = "00000000-0000-0000-0000-000000000404";
    try {
      await seedCompany(owner);
      await createGrant(owner, grantId, "grant-delete-skipped");
      await owner.query(`
        CREATE FUNCTION public.skip_role_grant_delete() RETURNS trigger AS $$
        BEGIN
          IF OLD.id = '${grantId}'::uuid THEN RETURN NULL; END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER company_role_assignment_skip_delete_fixture
          BEFORE DELETE ON public.company_role_assignment
          FOR EACH ROW EXECUTE FUNCTION public.skip_role_grant_delete();
      `);

      await expect(
        deleteCompanyRoleAssignmentWithAudit(app, {
          actorUserId: systemUserId,
          assignmentId: grantId,
          companyId,
        }),
      ).rejects.toThrow("company-role assignment disappeared while locked");
      await expect(
        owner.query("SELECT id FROM public.company_role_assignment WHERE id = $1", [grantId]),
      ).resolves.toMatchObject({ rows: [{ id: grantId }] });
      await expect(
        owner.query("SELECT entity_id FROM public.audit_log WHERE entity_id = $1", [grantId]),
      ).resolves.toMatchObject({ rows: [] });
    } finally {
      await owner
        .query("DROP TRIGGER IF EXISTS company_role_assignment_skip_delete_fixture ON public.company_role_assignment")
        .catch(() => undefined);
      await owner.query("DROP FUNCTION IF EXISTS public.skip_role_grant_delete()")
        .catch(() => undefined);
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("rolls back the revocation when its immutable audit insert fails", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const grantId = "00000000-0000-0000-0000-000000000403";
    try {
      await seedCompany(owner);
      await createGrant(owner, grantId, "grant-rollback");
      await owner.query(`
        CREATE FUNCTION public.reject_role_revoke_audit() RETURNS trigger AS $$
        BEGIN
          IF NEW.action = 'company_role_assignment.revoked' THEN
            RAISE EXCEPTION 'audit fixture rejection';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER audit_log_reject_role_revoke_fixture
          BEFORE INSERT ON public.audit_log
          FOR EACH ROW EXECUTE FUNCTION public.reject_role_revoke_audit();
      `);

      await expect(
        deleteCompanyRoleAssignmentWithAudit(app, {
          actorUserId: systemUserId,
          assignmentId: grantId,
          companyId,
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining("audit fixture rejection") });
      await expect(
        owner.query("SELECT id FROM public.company_role_assignment WHERE id = $1", [grantId]),
      ).resolves.toMatchObject({ rows: [{ id: grantId }] });
    } finally {
      await owner
        .query("DROP TRIGGER IF EXISTS audit_log_reject_role_revoke_fixture ON public.audit_log")
        .catch(() => undefined);
      await owner.query("DROP FUNCTION IF EXISTS public.reject_role_revoke_audit()")
        .catch(() => undefined);
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);
});
