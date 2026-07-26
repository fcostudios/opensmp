import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import {
  createIdentityAccessRepository,
  IdentityLinkError,
} from "./repository";

const systemUserId = "00000000-0000-0000-0000-000000000001";
const companyA = "00000000-0000-0000-0000-000000000451";
const companyB = "00000000-0000-0000-0000-000000000452";
const loginAt = new Date("2026-07-25T12:00:00.000Z");

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;

async function seedAccount({
  id,
  email,
  idpSubject = null,
  status = "active",
  globalRole = null,
  uiLanguage = null,
}: {
  id: string;
  email: string;
  idpSubject?: string | null;
  status?: "active" | "disabled";
  globalRole?: "group_admin" | "central_finance" | null;
  uiLanguage?: "es" | "en" | null;
}) {
  await owner.query(
    `INSERT INTO user_account (
       id, email, idp_subject, global_role, ui_language, status, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [id, email, idpSubject, globalRole, uiLanguage, status],
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
       ($1, 'Company A', 'AUTH-A', 'internal', 'active', now(), $3),
       ($2, 'Company B', 'AUTH-B', 'internal', 'active', now(), $3)`,
    [companyA, companyB, systemUserId],
  );
}, 150_000);

afterAll(async () => {
  await Promise.all([appPool.end(), owner.end()]);
  await fixture.stop();
}, 150_000);

describe("identity-access repository", () => {
  test("atomically links a verified email, updates last login, and writes a sanitized success audit", async () => {
    const accountId = "00000000-0000-0000-0000-000000000461";
    await seedAccount({
      id: accountId,
      email: "First.Login@Corporativo.Example",
    });
    const repository = createIdentityAccessRepository(
      drizzle(appPool, { schema }),
    );

    const account = await repository.completeOidcLogin({
      provider: "keycloak",
      subject: "keycloak-first-login",
      email: "first.login@corporativo.example",
      emailVerified: true,
      loginAt,
    });

    expect(account).toMatchObject({
      id: accountId,
      idpSubject: "keycloak-first-login",
      email: "First.Login@Corporativo.Example",
    });
    const persisted = await owner.query(
      `SELECT idp_subject, last_login_at
       FROM user_account WHERE id = $1`,
      [accountId],
    );
    expect(persisted.rows).toEqual([
      {
        idp_subject: "keycloak-first-login",
        last_login_at: loginAt,
      },
    ]);
    const audit = await owner.query(
      `SELECT actor_user_id, action, entity_id, before, after, note
       FROM audit_log
       WHERE after->>'errorCode' = 'none'
         AND actor_user_id = $1`,
      [accountId],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: accountId,
        action: "authentication.oidc.succeeded",
        entity_id: "00000000-0000-0000-0000-000000000004",
        before: null,
        after: { provider: "keycloak", errorCode: "none" },
        note: null,
      },
    ]);
  });

  test.each([
    {
      name: "an unverified email",
      id: "00000000-0000-0000-0000-000000000462",
      email: "unverified@corporativo.example",
      subject: "keycloak-unverified",
      emailVerified: false,
      status: "active" as const,
      existingSubject: null,
      code: "unverified_email",
      expectedActor: null,
    },
    {
      name: "an unknown email",
      id: null,
      email: "unknown@corporativo.example",
      subject: "keycloak-unknown",
      emailVerified: true,
      status: "active" as const,
      existingSubject: null,
      code: "unknown_account",
      expectedActor: null,
    },
    {
      name: "a disabled account",
      id: "00000000-0000-0000-0000-000000000463",
      email: "disabled@corporativo.example",
      subject: "keycloak-disabled",
      emailVerified: true,
      status: "disabled" as const,
      existingSubject: "keycloak-disabled",
      code: "account_disabled",
      expectedActor: "00000000-0000-0000-0000-000000000463",
    },
    {
      name: "a conflicting subject",
      id: "00000000-0000-0000-0000-000000000464",
      email: "conflict@corporativo.example",
      subject: "keycloak-new-subject",
      emailVerified: true,
      status: "active" as const,
      existingSubject: "keycloak-existing-subject",
      code: "subject_conflict",
      expectedActor: "00000000-0000-0000-0000-000000000464",
    },
  ])(
    "rejects $name and audits only its sanitized error code",
    async ({
      id,
      email,
      subject,
      emailVerified,
      status,
      existingSubject,
      code,
      expectedActor,
    }) => {
      if (id) {
        await seedAccount({
          id,
          email,
          idpSubject: existingSubject,
          status,
        });
      }
      const repository = createIdentityAccessRepository(
        drizzle(appPool, { schema }),
      );

      await expect(
        repository.completeOidcLogin({
          provider: "keycloak",
          subject,
          email,
          emailVerified,
          loginAt,
        }),
      ).rejects.toMatchObject({
        code: code as IdentityLinkError["code"],
      });

      const audit = await owner.query(
        `SELECT actor_user_id, action, entity_id, before, after, note
         FROM audit_log
         WHERE after->>'errorCode' = $1`,
        [code],
      );
      expect(audit.rows).toEqual([
        {
          actor_user_id: expectedActor,
          action: "authentication.oidc.failed",
          entity_id: "00000000-0000-0000-0000-000000000004",
          before: null,
          after: { provider: "keycloak", errorCode: code },
          note: null,
        },
      ]);
      expect(JSON.stringify(audit.rows)).not.toContain(subject);
      expect(JSON.stringify(audit.rows)).not.toContain(email);
    },
  );

  test("serializes concurrent first-login attempts so only one subject can link", async () => {
    const accountId = "00000000-0000-0000-0000-000000000465";
    const email = "race@corporativo.example";
    await seedAccount({ id: accountId, email });
    const repository = createIdentityAccessRepository(
      drizzle(appPool, { schema }),
    );

    const outcomes = await Promise.allSettled([
      repository.completeOidcLogin({
        provider: "keycloak",
        subject: "keycloak-race-a",
        email,
        emailVerified: true,
        loginAt,
      }),
      repository.completeOidcLogin({
        provider: "keycloak",
        subject: "keycloak-race-b",
        email,
        emailVerified: true,
        loginAt,
      }),
    ]);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejection = outcomes.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: { code: "subject_conflict" },
    });
    const persisted = await owner.query(
      "SELECT idp_subject FROM user_account WHERE id = $1",
      [accountId],
    );
    expect(["keycloak-race-a", "keycloak-race-b"]).toContain(
      persisted.rows[0]?.idp_subject,
    );
  });

  test.each([
    {
      name: "two eligible case variants",
      subject: "keycloak-case-ambiguous",
      accounts: [
        {
          id: "00000000-0000-0000-0000-000000000468",
          email: "Case.Ambiguous@corporativo.example",
          status: "active" as const,
          idpSubject: null,
        },
        {
          id: "00000000-0000-0000-0000-000000000469",
          email: "case.ambiguous@corporativo.example",
          status: "active" as const,
          idpSubject: null,
        },
      ],
    },
    {
      name: "eligible, disabled, and already-linked case variants",
      subject: "keycloak-mixed-ambiguous",
      accounts: [
        {
          id: "00000000-0000-0000-0000-000000000475",
          email: "Mixed.Ambiguous@corporativo.example",
          status: "active" as const,
          idpSubject: null,
        },
        {
          id: "00000000-0000-0000-0000-000000000476",
          email: "mixed.ambiguous@corporativo.example",
          status: "disabled" as const,
          idpSubject: null,
        },
        {
          id: "00000000-0000-0000-0000-000000000477",
          email: "MIXED.AMBIGUOUS@corporativo.example",
          status: "active" as const,
          idpSubject: "another-keycloak-subject",
        },
      ],
    },
  ])(
    "rejects $name deterministically without linking any account",
    async ({ accounts, subject }) => {
      for (const account of accounts) await seedAccount(account);
      const repository = createIdentityAccessRepository(
        drizzle(appPool, { schema }),
      );

      await expect(
        repository.completeOidcLogin({
          provider: "keycloak",
          subject,
          email: accounts[0]!.email.toLowerCase(),
          emailVerified: true,
          loginAt,
        }),
      ).rejects.toMatchObject({
        code: "ambiguous_email",
        actorUserId: null,
      });

      const persisted = await owner.query(
        `SELECT id, idp_subject, last_login_at
         FROM user_account
         WHERE lower(email) = lower($1)
         ORDER BY id`,
        [accounts[0]!.email],
      );
      expect(persisted.rows).toEqual(
        accounts.map((account) => ({
          id: account.id,
          idp_subject: account.idpSubject,
          last_login_at: null,
        })),
      );
      const audit = await owner.query(
        `SELECT actor_user_id, action, after
         FROM audit_log
         WHERE after->>'errorCode' = 'ambiguous_email'
         ORDER BY occurred_at, id`,
      );
      expect(audit.rows.at(-1)).toEqual({
        actor_user_id: null,
        action: "authentication.oidc.failed",
        after: { provider: "keycloak", errorCode: "ambiguous_email" },
      });
    },
  );

  test("rolls back identity linking when its success audit cannot be inserted", async () => {
    const accountId = "00000000-0000-0000-0000-000000000466";
    await seedAccount({
      id: accountId,
      email: "audit-rollback@corporativo.example",
    });
    await owner.query(`
      CREATE FUNCTION reject_auth_success_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'authentication.oidc.succeeded' THEN
          RAISE EXCEPTION 'forced auth audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_auth_success_audit
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION reject_auth_success_audit();
    `);
    const repository = createIdentityAccessRepository(
      drizzle(appPool, { schema }),
    );
    try {
      await expect(
        repository.completeOidcLogin({
          provider: "keycloak",
          subject: "keycloak-audit-rollback",
          email: "audit-rollback@corporativo.example",
          emailVerified: true,
          loginAt,
        }),
      ).rejects.toMatchObject({ code: "provider_callback_failed" });
      const persisted = await owner.query(
        `SELECT idp_subject, last_login_at
         FROM user_account WHERE id = $1`,
        [accountId],
      );
      expect(persisted.rows).toEqual([
        { idp_subject: null, last_login_at: null },
      ]);
    } finally {
      await owner.query(`
        DROP TRIGGER reject_auth_success_audit ON audit_log;
        DROP FUNCTION reject_auth_success_audit();
      `);
    }
  });

  test("loads current Ledger roles only and orders company grants deterministically", async () => {
    const accountId = "00000000-0000-0000-0000-000000000467";
    await seedAccount({
      id: accountId,
      email: "roles@corporativo.example",
      idpSubject: "keycloak-role-source",
      globalRole: "central_finance",
      uiLanguage: "es",
    });
    await owner.query(
      `INSERT INTO company_role_assignment (
         id, user_account_id, company_id, role, valid_from, valid_to,
         unique_grant, created_at, created_by
       ) VALUES
         ('00000000-0000-0000-0000-000000000471', $1, $2, 'viewer',
          NULL, NULL, 'auth-viewer', now(), $4),
         ('00000000-0000-0000-0000-000000000472', $1, $3, 'approver',
          CURRENT_DATE, CURRENT_DATE, 'auth-approver', now(), $4),
         ('00000000-0000-0000-0000-000000000473', $1, $2, 'finance',
          NULL, CURRENT_DATE - 1, 'auth-expired', now(), $4),
         ('00000000-0000-0000-0000-000000000474', $1, $3, 'finance',
          CURRENT_DATE + 1, NULL, 'auth-future', now(), $4)`,
      [accountId, companyB, companyA, systemUserId],
    );
    const repository = createIdentityAccessRepository(
      drizzle(appPool, { schema }),
    );

    const sessionUser = await repository.loadSessionUser({
      subject: "keycloak-role-source",
      name: "Role Source",
    });

    expect(sessionUser).toEqual({
      id: accountId,
      idpSubject: "keycloak-role-source",
      email: "roles@corporativo.example",
      name: "Role Source",
      globalRole: "central_finance",
      employeeCompanyId: null,
      roles: ["central_finance", "approver", "viewer"],
      companyIds: [companyA, companyB],
      companyGrants: [
        { companyId: companyA, role: "approver" },
        { companyId: companyB, role: "viewer" },
      ],
      uiLanguage: "es",
    });
  });
});
