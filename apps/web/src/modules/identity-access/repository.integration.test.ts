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
  createUserAdministrationRepository,
  IdentityLinkError,
} from "./repository";
import { createProviderOperationRepository } from "./provider-operation-repository";

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
  lastLoginAt = null,
}: {
  id: string;
  email: string;
  idpSubject?: string | null;
  status?: "active" | "disabled";
  globalRole?: "group_admin" | "central_finance" | null;
  uiLanguage?: "es" | "en" | null;
  lastLoginAt?: Date | null;
}) {
  await owner.query(
    `INSERT INTO user_account (
       id, email, idp_subject, global_role, ui_language, status,
       last_login_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      id,
      email,
      idpSubject,
      globalRole,
      uiLanguage,
      status,
      lastLoginAt,
    ],
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
  test("claims and transitions provider operations only with the exact trusted company scope and lease", async () => {
    const repository = createProviderOperationRepository(drizzle(appPool, { schema }));
    const claimedAt = new Date("2026-08-03T17:00:00.000Z");
    const leaseExpiresAt = new Date("2026-08-03T17:05:00.000Z");
    const leaseToken = "00000000-0000-4000-8000-000000000481";
    const operation = await repository.request({
      actorUserId: systemUserId,
      companyId: companyA,
      idempotencyKey: "scope-a-operation-us011",
      kind: "disable_user",
      occurredAt: claimedAt,
      payload: { userAccountId: systemUserId, note: "Scoped operation" },
      targetUserAccountId: systemUserId,
    });

    await expect(repository.claimById({
      id: operation.id,
      companyId: companyB,
      claimedAt,
      leaseExpiresAt,
      leaseToken,
    })).resolves.toBeNull();
    await expect(repository.claimById({
      id: operation.id,
      companyId: null,
      claimedAt,
      leaseExpiresAt,
      leaseToken,
    })).resolves.toBeNull();
    const claimed = await repository.claimById({
      id: operation.id,
      companyId: companyA,
      claimedAt,
      leaseExpiresAt,
      leaseToken,
    });
    expect(claimed).toMatchObject({
      id: operation.id,
      companyId: companyA,
      leaseToken,
      leaseExpiresAt,
      status: "pending",
    });

    await expect(repository.checkpointProviderApplied({
      id: operation.id,
      companyId: companyB,
      leaseToken,
      providerSubject: "scoped-provider-subject",
      attemptedAt: claimedAt,
    })).rejects.toThrow("provider_operation_not_claimed");
    await expect(repository.checkpointProviderApplied({
      id: operation.id,
      companyId: companyA,
      leaseToken: "00000000-0000-4000-8000-000000000482",
      providerSubject: "scoped-provider-subject",
      attemptedAt: claimedAt,
    })).rejects.toThrow("provider_operation_not_claimed");
    await expect(repository.checkpointProviderApplied({
      id: operation.id,
      companyId: companyA,
      leaseToken,
      providerSubject: "scoped-provider-subject",
      attemptedAt: claimedAt,
    })).resolves.toMatchObject({
      companyId: companyA,
      providerSubject: "scoped-provider-subject",
      status: "provider_applied",
    });
  });

  test("rejects idempotency-key reuse unless the stored request metadata and payload are identical", async () => {
    const repository = createProviderOperationRepository(drizzle(appPool, { schema }));
    const occurredAt = new Date("2026-08-03T17:10:00.000Z");
    const alternateUserId = "00000000-0000-0000-0000-000000000487";
    await seedAccount({
      id: alternateUserId,
      email: "idempotency-alternate-us011@example.com",
      idpSubject: "idempotency-alternate-us011",
    });
    const request = {
      actorUserId: systemUserId,
      companyId: companyA,
      idempotencyKey: "payload-contract-operation-us011",
      kind: "disable_user" as const,
      occurredAt,
      payload: { actorSubject: "system-us011", userAccountId: systemUserId, note: "Original note" },
      targetUserAccountId: systemUserId,
    };
    const original = await repository.request(request);

    await expect(repository.request({
      ...request,
      payload: { ...request.payload, note: "Changed note" },
    })).rejects.toThrow("provider_operation_idempotency_mismatch");
    await expect(repository.request({ ...request, companyId: companyB }))
      .rejects.toThrow("provider_operation_idempotency_mismatch");
    await expect(repository.request({ ...request, actorUserId: alternateUserId }))
      .rejects.toThrow("provider_operation_idempotency_mismatch");
    await expect(repository.request({ ...request, kind: "reset_two_factor" }))
      .rejects.toThrow("provider_operation_idempotency_mismatch");
    await expect(repository.request({ ...request, targetUserAccountId: alternateUserId }))
      .rejects.toThrow("provider_operation_idempotency_mismatch");
    await expect(repository.request(request)).resolves.toMatchObject({ id: original.id });
  });

  test("due claims include global and authorized-company work but never another company", async () => {
    const repository = createProviderOperationRepository(drizzle(appPool, { schema }));
    const occurredAt = new Date("2026-08-03T17:01:00.000Z");
    const requests = await Promise.all([
      repository.request({
        actorUserId: systemUserId,
        companyId: null,
        idempotencyKey: "due-global-operation-us011",
        kind: "reset_two_factor",
        occurredAt,
        payload: { actorSubject: "system-us011", userAccountId: systemUserId, note: "Global due" },
        targetUserAccountId: systemUserId,
      }),
      repository.request({
        actorUserId: systemUserId,
        companyId: companyA,
        idempotencyKey: "due-company-a-operation-us011",
        kind: "disable_user",
        occurredAt: new Date(occurredAt.getTime() + 1),
        payload: { actorSubject: "system-us011", userAccountId: systemUserId, note: "Company A due" },
        targetUserAccountId: systemUserId,
      }),
      repository.request({
        actorUserId: systemUserId,
        companyId: companyB,
        idempotencyKey: "due-company-b-operation-us011",
        kind: "disable_user",
        occurredAt: new Date(occurredAt.getTime() + 2),
        payload: { actorSubject: "system-us011", userAccountId: systemUserId, note: "Company B due" },
        targetUserAccountId: systemUserId,
      }),
    ]);
    const claimedAt = new Date("2026-08-03T17:02:00.000Z");

    const first = await repository.claimDue({
      companyIds: [companyA],
      claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + 300_000),
      leaseToken: "00000000-0000-4000-8000-000000000483",
    });
    const second = await repository.claimDue({
      companyIds: [companyA],
      claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + 300_000),
      leaseToken: "00000000-0000-4000-8000-000000000484",
    });
    const third = await repository.claimDue({
      companyIds: [companyA],
      claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + 300_000),
      leaseToken: "00000000-0000-4000-8000-000000000485",
    });

    expect([first?.id, second?.id]).toEqual([requests[0]?.id, requests[1]?.id]);
    expect(third).toBeNull();
    expect(requests[2]?.companyId).toBe(companyB);
  });

  test("Ledger finalization cannot cross a company scope or treat global NULL as a wildcard", async () => {
    const database = drizzle(appPool, { schema });
    const operations = createProviderOperationRepository(database);
    const repository = createUserAdministrationRepository(database);
    const occurredAt = new Date("2026-08-03T17:20:00.000Z");
    const leaseToken = "00000000-0000-4000-8000-000000000486";
    const operation = await operations.request({
      actorUserId: systemUserId,
      companyId: companyA,
      idempotencyKey: "finalization-scope-operation-us011",
      kind: "reset_two_factor",
      occurredAt,
      payload: { actorSubject: "system-us011", userAccountId: systemUserId, note: "Exact finalization scope" },
      targetUserAccountId: systemUserId,
    });
    await operations.claimById({
      id: operation.id,
      companyId: companyA,
      claimedAt: occurredAt,
      leaseExpiresAt: new Date(occurredAt.getTime() + 300_000),
      leaseToken,
    });
    await operations.checkpointProviderApplied({
      id: operation.id,
      companyId: companyA,
      leaseToken,
      providerSubject: "system",
      attemptedAt: occurredAt,
    });
    const finalize = (companyId: string | null) => repository.finalizeUserMutation({
      action: "identity.user.two_factor_reset",
      actorUserId: systemUserId,
      companyId,
      leaseToken,
      note: "Exact finalization scope",
      operationId: operation.id,
      occurredAt,
      statusBefore: "active",
      userAccountId: systemUserId,
    });

    await expect(finalize(companyB)).rejects.toThrow("provider_operation_not_claimed");
    await expect(finalize(null)).rejects.toThrow("provider_operation_not_claimed");
    await expect(finalize(companyA)).resolves.toEqual({ id: systemUserId });
    const persisted = await owner.query(
      "SELECT company_id, status FROM identity_provider_operation WHERE id = $1",
      [operation.id],
    );
    expect(persisted.rows).toEqual([{ company_id: companyA, status: "completed" }]);
  });

  test("identity-link errors preserve their exact public code, name, and sanitized message", () => {
    const error = new IdentityLinkError(
      "missing_identity_claim",
      "00000000-0000-0000-0000-000000000490",
    );
    expect(error).toMatchObject({
      actorUserId: "00000000-0000-0000-0000-000000000490",
      code: "missing_identity_claim",
      message: "OIDC login rejected: missing_identity_claim",
      name: "IdentityLinkError",
    });
  });

  test.each([
    { email: "claim-subject@example.com", subject: "   " },
    { email: "   ", subject: "claim-email" },
  ])("rejects an individually blank OIDC claim before account lookup", async ({ email, subject }) => {
    const repository = createIdentityAccessRepository(
      drizzle(appPool, { schema }),
    );
    await expect(repository.completeOidcLogin({
      provider: "keycloak",
      subject,
      email,
      emailVerified: true,
      loginAt,
    })).rejects.toMatchObject({
      code: "missing_identity_claim",
      message: "OIDC login rejected: missing_identity_claim",
      name: "IdentityLinkError",
    });
  });

  test("atomically links a verified email and records the exact tenant-scoped account diff", async () => {
    const accountId = "00000000-0000-0000-0000-000000000461";
    const personId = "00000000-0000-0000-0000-000000000471";
    const previousLoginAt = new Date("2026-07-24T12:00:00.000Z");
    await seedAccount({
      id: accountId,
      email: "First.Login@Corporativo.Example",
      lastLoginAt: previousLoginAt,
    });
    await owner.query(
      `INSERT INTO person (
         id, email, full_name, company_id, status, created_at, created_by
       ) VALUES ($1, $2, 'First Login', $3, 'active', now(), $4)`,
      [
        personId,
        "first.login@corporativo.example",
        companyA,
        accountId,
      ],
    );
    await owner.query(
      `UPDATE user_account SET person_id = $1 WHERE id = $2`,
      [personId, accountId],
    );
    const repository = createIdentityAccessRepository(
      drizzle(appPool, { schema }),
    );

    const account = await repository.completeOidcLogin({
      provider: "keycloak",
      subject: "keycloak-first-login",
      email: "  first.login@corporativo.example  ",
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
      `SELECT actor_user_id, action, entity_type, entity_id, company_id,
              before, after, note, occurred_at
       FROM audit_log
       WHERE action = 'authentication.oidc.succeeded'
         AND actor_user_id = $1`,
      [accountId],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: accountId,
        action: "authentication.oidc.succeeded",
        entity_type: "UserAccount",
        entity_id: accountId,
        company_id: companyA,
        before: {
          idp_subject: null,
          last_login_at: previousLoginAt.toISOString(),
        },
        after: {
          idp_subject: "keycloak-first-login",
          last_login_at: loginAt.toISOString(),
        },
        note: null,
        occurred_at: loginAt,
      },
    ]);
    expect(JSON.stringify(audit.rows[0])).not.toMatch(
      /provider|client_secret|token/i,
    );
  });

  test("accepts a repeat callback only when the existing subject is identical", async () => {
    const accountId = "00000000-0000-0000-0000-000000000491";
    const previousLoginAt = new Date("2026-07-24T13:00:00.000Z");
    await seedAccount({
      id: accountId,
      email: "repeat-login@corporativo.example",
      idpSubject: "repeat-login-subject",
      lastLoginAt: previousLoginAt,
    });
    const repository = createIdentityAccessRepository(
      drizzle(appPool, { schema }),
    );

    await expect(repository.completeOidcLogin({
      provider: "keycloak",
      subject: "repeat-login-subject",
      email: "repeat-login@corporativo.example",
      emailVerified: true,
      loginAt,
    })).resolves.toMatchObject({
      id: accountId,
      idpSubject: "repeat-login-subject",
    });
    const audit = await owner.query(
      `SELECT before, after
       FROM audit_log
       WHERE action = 'authentication.oidc.succeeded' AND entity_id = $1`,
      [accountId],
    );
    expect(audit.rows).toEqual([{
      before: {
        idp_subject: "repeat-login-subject",
        last_login_at: previousLoginAt.toISOString(),
      },
      after: {
        idp_subject: "repeat-login-subject",
        last_login_at: loginAt.toISOString(),
      },
    }]);
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

  test("session loading rejects unknown and disabled accounts and falls back to the Ledger email for a blank name", async () => {
    const disabledId = "00000000-0000-0000-0000-000000000478";
    const fallbackId = "00000000-0000-0000-0000-000000000479";
    await seedAccount({ id: disabledId, email: "session-disabled@example.com", idpSubject: "session-disabled", status: "disabled" });
    await seedAccount({ id: fallbackId, email: "session-fallback@example.com", idpSubject: "session-fallback", globalRole: "group_admin" });
    const repository = createIdentityAccessRepository(drizzle(appPool, { schema }));

    await expect(repository.loadSessionUser({ subject: "missing-subject", name: "Missing" })).resolves.toBeNull();
    await expect(repository.loadSessionUser({ subject: "session-disabled", name: "Disabled" })).resolves.toBeNull();
    await expect(repository.loadSessionUser({ subject: "session-fallback", name: "   " })).resolves.toMatchObject({
      id: fallbackId,
      idpSubject: "session-fallback",
      email: "session-fallback@example.com",
      name: "session-fallback@example.com",
      globalRole: "group_admin",
      roles: ["group_admin"],
    });
  });

  test("available-person reads require active, unlinked people inside the requested company set", async () => {
    const availableId = "00000000-0000-0000-0000-000000000481";
    const linkedId = "00000000-0000-0000-0000-000000000482";
    const otherCompanyId = "00000000-0000-0000-0000-000000000483";
    const inactiveId = "00000000-0000-0000-0000-000000000484";
    await owner.query(
      `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
       VALUES ($1, 'available@example.com', 'Available Person', $5, 'active', now(), $6),
              ($2, 'linked@example.com', 'Linked Person', $5, 'active', now(), $6),
              ($3, 'other@example.com', 'Other Company Person', $7, 'active', now(), $6),
              ($4, 'inactive@example.com', 'Inactive Person', $5, 'departed', now(), $6)`,
      [availableId, linkedId, otherCompanyId, inactiveId, companyA, systemUserId, companyB],
    );
    const linkedAccountId = "00000000-0000-0000-0000-000000000485";
    await seedAccount({ id: linkedAccountId, email: "linked-account@example.com", idpSubject: "linked-account" });
    await owner.query("UPDATE user_account SET person_id = $1 WHERE id = $2", [linkedId, linkedAccountId]);
    const repository = createUserAdministrationRepository(drizzle(appPool, { schema }));

    await expect(repository.listAvailablePeople([companyA])).resolves.toEqual([{ id: availableId, fullName: "Available Person" }]);
    await expect(repository.listAvailablePeople([companyB])).resolves.toEqual([{ id: otherCompanyId, fullName: "Other Company Person" }]);
  });
});
