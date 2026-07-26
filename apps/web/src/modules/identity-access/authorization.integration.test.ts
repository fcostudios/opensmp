import { drizzle } from "drizzle-orm/node-postgres";
import { and, inArray } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import { person } from "@smp/db/schema";
import { hasCapability } from "@smp/domain/identity-access";

import {
  assertCapability,
  authorizeCompanyDataAccess,
  AuthorizationError,
  companyScope,
  createAuthorizationRepository,
} from "./authorization";
import { authorizeCompanyRequestWithSession } from "./authorization-response";

const systemUserId = "00000000-0000-0000-0000-000000000001";
const companyA = "00000000-0000-0000-0000-000000000551";
const companyB = "00000000-0000-0000-0000-000000000552";
const companyC = "00000000-0000-0000-0000-000000000553";

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;

async function seedAccount({
  id,
  subject,
  globalRole = null,
  personCompanyId = null,
  status = "active",
}: {
  id: string;
  subject: string;
  globalRole?: "group_admin" | "central_finance" | null;
  personCompanyId?: string | null;
  status?: "active" | "disabled";
}) {
  const personId = personCompanyId
    ? id.replace(/.$/, (digit) => String((Number(digit) + 1) % 10))
    : null;
  if (personId && personCompanyId) {
    await owner.query(
      `INSERT INTO person (
         id, email, full_name, company_id, status, created_at, created_by
       ) VALUES ($1, $2, 'Employee', $3, 'active', now(), $4)`,
      [personId, `${subject}@person.example`, personCompanyId, systemUserId],
    );
  }
  await owner.query(
    `INSERT INTO user_account (
       id, email, idp_subject, global_role, person_id, status, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [id, `${subject}@account.example`, subject, globalRole, personId, status],
  );
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  appPool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(
    `INSERT INTO company (id, name, code, type, status, created_at, created_by)
     VALUES
       ($1, 'Company A', 'RBAC-A', 'internal', 'active', now(), $4),
       ($2, 'Company B', 'RBAC-B', 'internal', 'active', now(), $4),
       ($3, 'Company C', 'RBAC-C', 'internal', 'inactive', now(), $4)`,
    [companyA, companyB, companyC, systemUserId],
  );
}, 150_000);

afterAll(async () => {
  await Promise.all([appPool.end(), owner.end()]);
  await fixture.stop();
}, 150_000);

describe("Ledger authorization repository", () => {
  test("resolves only current grants plus the employee company with exact role and company scope", async () => {
    const accountId = "00000000-0000-0000-0000-000000000561";
    await seedAccount({
      id: accountId,
      subject: "scoped-user",
      personCompanyId: companyA,
    });
    await owner.query(
      `INSERT INTO company_role_assignment (
         id, user_account_id, company_id, role, valid_from, valid_to,
         unique_grant, created_at, created_by
       ) VALUES
         ('00000000-0000-0000-0000-000000000571', $1, $2, 'viewer',
          NULL, NULL, 'rbac-current-viewer', now(), $5),
         ('00000000-0000-0000-0000-000000000572', $1, $3, 'approver',
          CURRENT_DATE, CURRENT_DATE, 'rbac-boundary-approver', now(), $5),
         ('00000000-0000-0000-0000-000000000573', $1, $4, 'finance',
          NULL, CURRENT_DATE - 1, 'rbac-expired-finance', now(), $5),
         ('00000000-0000-0000-0000-000000000574', $1, $4, 'viewer',
          CURRENT_DATE + 1, NULL, 'rbac-future-viewer', now(), $5),
         ('00000000-0000-0000-0000-000000000579', $1, $2, 'finance',
          NULL, NULL, 'rbac-current-finance', now(), $5)`,
      [accountId, companyB, companyC, companyA, systemUserId],
    );
    const repository = createAuthorizationRepository(
      drizzle(appPool, { schema }),
    );

    const authorization = await repository.load({ subject: "scoped-user" });

    expect(authorization).toEqual({
      userId: accountId,
      userAccountId: accountId,
      idpSubject: "scoped-user",
      globalRole: null,
      roles: ["employee", "approver", "company_finance", "viewer"],
      companyIds: [companyA, companyB, companyC],
      employeeCompanyId: companyA,
      companyGrants: [
        { companyId: companyB, role: "finance" },
        { companyId: companyB, role: "viewer" },
        { companyId: companyC, role: "approver" },
      ],
    });
  });

  test.each(["group_admin", "central_finance"] as const)(
    "%s receives every company through its global role",
    async (globalRole) => {
      const suffix = globalRole === "group_admin" ? "2" : "3";
      const accountId = `00000000-0000-0000-0000-00000000056${suffix}`;
      await seedAccount({
        id: accountId,
        subject: `global-${globalRole}`,
        globalRole,
      });
      const repository = createAuthorizationRepository(
        drizzle(appPool, { schema }),
      );

      const authorization = await repository.load({
        subject: `global-${globalRole}`,
      });
      expect(authorization).not.toBeNull();
      expect(
        hasCapability(
          authorization!,
          globalRole === "group_admin"
            ? "admin:manage"
            : "finance:close",
          companyC,
        ),
      ).toBe(true);
      expect(
        hasCapability(authorization!, "admin:manage", companyC),
      ).toBe(globalRole === "group_admin");
      await expect(
        repository.load({
          subject: `global-${globalRole}`,
        }),
      ).resolves.toEqual({
        userId: accountId,
        userAccountId: accountId,
        idpSubject: `global-${globalRole}`,
        globalRole,
        roles: [globalRole],
        companyIds: [companyA, companyB, companyC],
        employeeCompanyId: null,
        companyGrants: [],
      });
    },
  );

  test("rejects unknown and disabled identities instead of returning empty authority", async () => {
    await seedAccount({
      id: "00000000-0000-0000-0000-000000000564",
      subject: "disabled-rbac",
      status: "disabled",
    });
    const repository = createAuthorizationRepository(
      drizzle(appPool, { schema }),
    );

    await expect(
      repository.load({ subject: "missing-rbac" }),
    ).resolves.toBeNull();
    await expect(
      repository.load({ subject: "disabled-rbac" }),
    ).resolves.toBeNull();
  });

  test("capability checks deny cross-capability writes and keep viewer read-only", async () => {
    const accountId = "00000000-0000-0000-0000-000000000565";
    await seedAccount({
      id: accountId,
      subject: "access-intent",
      personCompanyId: companyA,
    });
    await owner.query(
      `INSERT INTO company_role_assignment (
         id, user_account_id, company_id, role, unique_grant, created_at, created_by
       ) VALUES
         ('00000000-0000-0000-0000-000000000575', $1, $2, 'viewer',
          'rbac-intent-viewer', now(), $4),
         ('00000000-0000-0000-0000-000000000576', $1, $3, 'approver',
          'rbac-intent-approver', now(), $4)`,
      [accountId, companyB, companyC, systemUserId],
    );
    const repository = createAuthorizationRepository(
      drizzle(appPool, { schema }),
    );
    const authorization = await repository.load({ subject: "access-intent" });
    expect(authorization).not.toBeNull();

    expect(
      assertCapability(authorization!, "request:create", companyA),
    ).toBe(companyA);
    expect(assertCapability(authorization!, "company:read", companyB)).toBe(
      companyB,
    );
    expect(
      assertCapability(authorization!, "request:approve", companyC),
    ).toBe(companyC);
    expect(() =>
      assertCapability(authorization!, "request:approve", companyB),
    ).toThrowError(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "capability_forbidden",
        status: 403,
      }),
    );
    expect(() =>
      assertCapability(authorization!, "company:read", systemUserId),
    ).toThrowError(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "capability_forbidden",
        status: 403,
      }),
    );
  });

  test("reloads Ledger grants for every data access so a revoked grant cannot authorize a later query", async () => {
    const accountId = "00000000-0000-0000-0000-000000000566";
    const grantId = "00000000-0000-0000-0000-000000000577";
    await seedAccount({
      id: accountId,
      subject: "revoked-between-accesses",
    });
    await owner.query(
      `INSERT INTO company_role_assignment (
         id, user_account_id, company_id, role, unique_grant, created_at, created_by
       ) VALUES ($1, $2, $3, 'viewer', 'rbac-revoked-viewer', now(), $4)`,
      [grantId, accountId, companyB, systemUserId],
    );
    const repository = createAuthorizationRepository(
      drizzle(appPool, { schema }),
    );

    await expect(
      authorizeCompanyDataAccess(repository, {
        subject: "revoked-between-accesses",
        companyId: companyB,
        capability: "company:read",
      }),
    ).resolves.toMatchObject({ userId: accountId });

    await owner.query(
      "DELETE FROM company_role_assignment WHERE id = $1",
      [grantId],
    );

    await expect(
      authorizeCompanyDataAccess(repository, {
        subject: "revoked-between-accesses",
        companyId: companyB,
        capability: "company:read",
      }),
    ).rejects.toMatchObject({
      code: "capability_forbidden",
      status: 403,
    });
  });

  test("returns sanitized 401 and 403 API decisions before a handler can access company data", async () => {
    const accountId = "00000000-0000-0000-0000-000000000567";
    await seedAccount({
      id: accountId,
      subject: "viewer-api-guard",
    });
    await owner.query(
      `INSERT INTO company_role_assignment (
         id, user_account_id, company_id, role, unique_grant, created_at, created_by
       ) VALUES (
         '00000000-0000-0000-0000-000000000578', $1, $2, 'viewer',
         'rbac-api-viewer', now(), $3
       )`,
      [accountId, companyB, systemUserId],
    );
    const repository = createAuthorizationRepository(
      drizzle(appPool, { schema }),
    );

    const unauthenticated = await authorizeCompanyRequestWithSession(
      null,
      repository,
      {
        companyId: companyB,
        capability: "company:read",
      },
    );
    const forbidden = await authorizeCompanyRequestWithSession(
      { user: { idpSubject: "viewer-api-guard" } },
      repository,
      {
        companyId: companyB,
        capability: "request:approve",
      },
    );
    const allowed = await authorizeCompanyRequestWithSession(
      { user: { idpSubject: "viewer-api-guard" } },
      repository,
      {
        companyId: companyB,
        capability: "company:read",
      },
    );

    expect(unauthenticated.ok).toBe(false);
    expect(forbidden.ok).toBe(false);
    expect(allowed).toEqual({
      ok: true,
      authorization: {
        userId: accountId,
        userAccountId: accountId,
        idpSubject: "viewer-api-guard",
        globalRole: null,
        roles: ["viewer"],
        companyIds: [companyB],
        employeeCompanyId: null,
        companyGrants: [{ companyId: companyB, role: "viewer" }],
      },
    });
    if (!unauthenticated.ok && !forbidden.ok) {
      expect(unauthenticated.response.status).toBe(401);
      await expect(unauthenticated.response.json()).resolves.toEqual({
        error: "Unauthorized",
      });
      expect(forbidden.response.status).toBe(403);
      await expect(forbidden.response.json()).resolves.toEqual({
        error: "Forbidden",
      });
    }
    const denialAudit = await owner.query(
      `SELECT actor_user_id, action, entity_type, company_id, before, after, note
       FROM audit_log
       WHERE action = 'authorization.denied' AND actor_user_id = $1`,
      [accountId],
    );
    expect(denialAudit.rows).toEqual([
      {
        actor_user_id: accountId,
        action: "authorization.denied",
        entity_type: "Authorization",
        company_id: companyB,
        before: null,
        after: {
          capability: "request:approve",
          errorCode: "capability_forbidden",
        },
        note: null,
      },
    ]);
  });

  test("propagates a real database failure instead of misreporting it as forbidden", async () => {
    const stoppedPool = new pg.Pool({ connectionString: fixture.appUrl });
    await stoppedPool.end();
    const repository = createAuthorizationRepository(
      drizzle(stoppedPool, { schema }),
    );

    await expect(
      authorizeCompanyRequestWithSession(
        { user: { idpSubject: "viewer-api-guard" } },
        repository,
        {
          companyId: companyB,
          capability: "company:read",
        },
      ),
    ).rejects.toThrow("Cannot use a pool after calling end on the pool");
  });

  test("audits a forbidden nonexistent company without violating the audit company foreign key", async () => {
    const nonexistentCompany =
      "00000000-0000-0000-0000-000000000599";
    const repository = createAuthorizationRepository(
      drizzle(appPool, { schema }),
    );

    const result = await authorizeCompanyRequestWithSession(
      { user: { idpSubject: "viewer-api-guard" } },
      repository,
      {
        companyId: nonexistentCompany,
        capability: "company:read",
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
    const audit = await owner.query(
      `SELECT company_id, after
       FROM audit_log
       WHERE action = 'authorization.denied'
         AND after->>'attemptedCompanyId' = $1`,
      [nonexistentCompany],
    );
    expect(audit.rows).toEqual([
      {
        company_id: null,
        after: {
          capability: "company:read",
          errorCode: "capability_forbidden",
          attemptedCompanyId: nonexistentCompany,
        },
      },
    ]);
  });

  test("companyScope filters real scoped rows and is omitted only for an explicit global capability", async () => {
    await seedAccount({
      id: "00000000-0000-0000-0000-000000000568",
      subject: "scope-row-b",
      personCompanyId: companyB,
    });
    const repository = createAuthorizationRepository(
      drizzle(appPool, { schema }),
    );
    const viewer = await repository.load({ subject: "viewer-api-guard" });
    const groupAdmin = await repository.load({
      subject: "global-group_admin",
    });
    const centralFinance = await repository.load({
      subject: "global-central_finance",
    });
    expect(viewer).not.toBeNull();
    expect(groupAdmin).not.toBeNull();
    expect(centralFinance).not.toBeNull();

    const database = drizzle(appPool, { schema });
    const emails = [
      "access-intent@person.example",
      "scope-row-b@person.example",
    ];
    const viewerRows = await database
      .select({ email: person.email, companyId: person.companyId })
      .from(person)
      .where(
        and(
          inArray(person.email, emails),
          companyScope(viewer!, person.companyId, "company:read"),
        ),
      );
    const adminScope = companyScope(
      groupAdmin!,
      person.companyId,
      "company:read",
    );
    const centralCompanyScope = companyScope(
      centralFinance!,
      person.companyId,
      "company:read",
    );

    expect(viewerRows).toEqual([
      {
        email: "scope-row-b@person.example",
        companyId: companyB,
      },
    ]);
    expect(adminScope).toBeUndefined();
    expect(centralCompanyScope).toBeDefined();
    const crossCapabilityRows = await database
      .select({ email: person.email })
      .from(person)
      .where(
        and(
          inArray(person.email, emails),
          companyScope(
            centralFinance!,
            person.companyId,
            "finance:read",
          ),
        ),
      );
    expect(crossCapabilityRows.map(({ email }) => email).sort()).toEqual(
      [...emails].sort(),
    );
  });
});
