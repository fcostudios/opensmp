import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import {
  createInMemoryKeycloakAdminClient,
  type InMemoryKeycloakAdminState,
} from "./keycloak-admin";
import {
  createUserAdminService,
} from "./user-admin-service";
import { createUserAdministrationRepository } from "./repository";

const systemUserId = "00000000-0000-0000-0000-000000000001";
const actorId = "00000000-0000-0000-0000-000000001101";
const companyA = "00000000-0000-0000-0000-000000001111";
const companyB = "00000000-0000-0000-0000-000000001112";
const now = new Date("2026-08-03T15:00:00.000Z");

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;
let state: InMemoryKeycloakAdminState;

async function insertUser(input: {
  id: string;
  email: string;
  subject: string;
  companyId?: string;
  totpSecret?: string | null;
}) {
  const personId = input.companyId
    ? `${input.id.slice(0, -4)}9${input.id.slice(-3)}`
    : null;
  if (personId && input.companyId) {
    await owner.query(
      `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
       VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
      [personId, `person-${input.email}`, input.email, input.companyId, now, systemUserId],
    );
  }
  await owner.query(
    `INSERT INTO user_account
       (id, email, idp_subject, totp_secret_encrypted, person_id, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
    [input.id, input.email, input.subject, input.totpSecret ?? null, personId, now],
  );
}

function service() {
  return createUserAdminService({
    database: drizzle(appPool, { schema }),
    keycloak: createInMemoryKeycloakAdminClient(state),
    now: () => now,
  });
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  appPool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(
    `INSERT INTO user_account
       (id, email, idp_subject, global_role, status, created_at)
     VALUES ($1, 'admin-us011@example.com', 'admin-us011', 'group_admin', 'active', $2)`,
    [actorId, now],
  );
  await owner.query(
    `INSERT INTO company (id, name, code, type, status, created_at, created_by)
     VALUES ($1, 'US011 A', 'US011-A', 'internal', 'active', $3, $4),
            ($2, 'US011 B', 'US011-B', 'internal', 'active', $3, $4)`,
    [companyA, companyB, now, systemUserId],
  );
}, 150_000);

afterAll(async () => {
  await Promise.all([appPool.end(), owner.end()]);
  await fixture.stop();
}, 150_000);

describe("US-011 user administration", () => {
  test("company-scoped reads exclude users and grants outside the authorized company set (kills missing-company-predicate mutants)", async () => {
    const userA = "00000000-0000-0000-0000-000000001131";
    const userB = "00000000-0000-0000-0000-000000001132";
    await insertUser({ id: userA, email: "read-a-us011@example.com", subject: "read-a-us011", companyId: companyA });
    await insertUser({ id: userB, email: "read-b-us011@example.com", subject: "read-b-us011", companyId: companyB });
    await owner.query(
      `INSERT INTO company_role_assignment
       (id, user_account_id, company_id, role, unique_grant, created_at, created_by)
       VALUES ('00000000-0000-0000-0000-000000001141', $1, $2, 'viewer', 'read-a-grant', $4, $3),
              ('00000000-0000-0000-0000-000000001142', $5, $6, 'viewer', 'read-b-grant', $4, $3)`,
      [userA, companyA, actorId, now, userB, companyB],
    );
    const repository = createUserAdministrationRepository(drizzle(appPool, { schema }));

    expect((await repository.listUsers([companyA])).map(({ id }) => id)).toContain(userA);
    expect((await repository.listUsers([companyA])).map(({ id }) => id)).not.toContain(userB);
    expect((await repository.listCompanyRoles([companyA])).map(({ companyId }) => companyId)).toEqual([companyA]);
    expect((await repository.listCompanies([companyA])).map(({ id }) => id)).toEqual([companyA]);
  });

  test("create persists the returned idp_subject and exact mandatory audit note (kills discarded-subject/note mutants)", async () => {
    state = { nextSubject: 41, users: new Map() };
    const created = await service().createUser("admin-us011", {
      email: "created-us011@example.com",
      displayName: "Created User",
      globalRole: "central_finance",
      personId: null,
      note: "Approved access request AR-41",
    });

    const account = await owner.query(
      "SELECT idp_subject, status FROM user_account WHERE id = $1",
      [created.id],
    );
    expect(account.rows).toEqual([
      { idp_subject: "in-memory-user-41", status: "active" },
    ]);
    const audit = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, note
       FROM audit_log WHERE entity_id = $1`,
      [created.id],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: actorId,
        action: "identity.user.created",
        entity_type: "UserAccount",
        entity_id: created.id,
        note: "Approved access request AR-41",
      },
    ]);
  });

  test("create compensates Keycloak when Ledger rejects persistence (kills orphan-provider-user mutant)", async () => {
    state = { nextSubject: 51, users: new Map() };
    await expect(
      service().createUser("admin-us011", {
        email: "created-us011@example.com",
        displayName: "Duplicate User",
        globalRole: null,
        personId: null,
        note: "Duplicate must be rejected",
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(state.users.size).toBe(0);
  });

  test("2FA state comes only from Keycloak OTP credentials (kills encrypted-secret-state mutant)", async () => {
    const pendingId = "00000000-0000-0000-0000-000000001121";
    const configuredId = "00000000-0000-0000-0000-000000001122";
    await insertUser({
      id: pendingId,
      email: "pending-us011@example.com",
      subject: "pending-us011",
      totpSecret: "legacy-secret-must-be-ignored",
    });
    await insertUser({
      id: configuredId,
      email: "configured-us011@example.com",
      subject: "configured-us011",
    });
    state = {
      nextSubject: 1,
      users: new Map([
        ["pending-us011", { email: "pending-us011@example.com", displayName: "Pending", enabled: true, otpCredentials: [], requiredActions: new Set() }],
        ["configured-us011", { email: "configured-us011@example.com", displayName: "Configured", enabled: true, otpCredentials: [{ id: "otp-1" }], requiredActions: new Set() }],
      ]),
    };
    const subjects = await owner.query<{ email: string; idp_subject: string }>(
      "SELECT email, idp_subject FROM user_account WHERE idp_subject IS NOT NULL",
    );
    for (const row of subjects.rows) {
      if (!state.users.has(row.idp_subject)) {
        state.users.set(row.idp_subject, {
          email: row.email,
          displayName: row.email,
          enabled: true,
          otpCredentials: [],
          requiredActions: new Set(),
        });
      }
    }

    const users = await service().listUsers("admin-us011");
    expect(users.find(({ id }) => id === pendingId)?.twoFactorStatus).toBe("pending");
    expect(users.find(({ id }) => id === configuredId)?.twoFactorStatus).toBe("configured");
  });

  test("reset removes every OTP credential, requires CONFIGURE_TOTP, and audits exact note (kills first-only/no-action mutants)", async () => {
    const userId = "00000000-0000-0000-0000-000000001123";
    await insertUser({ id: userId, email: "reset-us011@example.com", subject: "reset-us011" });
    state = {
      nextSubject: 1,
      users: new Map([["reset-us011", { email: "reset-us011@example.com", displayName: "Reset", enabled: true, otpCredentials: [{ id: "otp-a" }, { id: "otp-b" }], requiredActions: new Set() }]]),
    };

    await service().resetTwoFactor("admin-us011", {
      userAccountId: userId,
      note: "Phone replaced after loss",
    });

    expect(state.users.get("reset-us011")?.otpCredentials).toEqual([]);
    expect(state.users.get("reset-us011")?.requiredActions).toEqual(new Set(["CONFIGURE_TOTP"]));
    const audit = await owner.query(
      "SELECT actor_user_id, action, entity_id, note FROM audit_log WHERE entity_id = $1",
      [userId],
    );
    expect(audit.rows).toEqual([{ actor_user_id: actorId, action: "identity.user.two_factor_reset", entity_id: userId, note: "Phone replaced after loss" }]);
  });

  test("disable rejects a mismatched company context without touching either company (kills unscoped-id update mutant)", async () => {
    const userId = "00000000-0000-0000-0000-000000001124";
    await insertUser({ id: userId, email: "scoped-us011@example.com", subject: "scoped-us011", companyId: companyA });
    state = {
      nextSubject: 1,
      users: new Map([["scoped-us011", { email: "scoped-us011@example.com", displayName: "Scoped", enabled: true, otpCredentials: [], requiredActions: new Set() }]]),
    };

    await expect(service().disableUser("admin-us011", {
      userAccountId: userId,
      companyId: companyB,
      note: "Wrong company target",
    })).rejects.toMatchObject({ code: "cross_company_target" });
    expect(state.users.get("scoped-us011")?.enabled).toBe(true);
    const row = await owner.query("SELECT status FROM user_account WHERE id = $1", [userId]);
    expect(row.rows).toEqual([{ status: "active" }]);

    await service().disableUser("admin-us011", {
      userAccountId: userId,
      companyId: companyA,
      note: "Employment ended",
    });
    expect(state.users.get("scoped-us011")?.enabled).toBe(false);
    const disabled = await owner.query("SELECT status FROM user_account WHERE id = $1", [userId]);
    expect(disabled.rows).toEqual([{ status: "disabled" }]);
    const audit = await owner.query(
      "SELECT actor_user_id, action, company_id, entity_id, note FROM audit_log WHERE entity_id = $1",
      [userId],
    );
    expect(audit.rows).toEqual([{ actor_user_id: actorId, action: "identity.user.disabled", company_id: companyA, entity_id: userId, note: "Employment ended" }]);
  });

  test("grant and remove preserve effective dates, company scope, and exact notes (kills date-drop/cross-company-delete mutants)", async () => {
    const userId = "00000000-0000-0000-0000-000000001125";
    await insertUser({ id: userId, email: "grant-us011@example.com", subject: "grant-us011", companyId: companyA });
    state = { nextSubject: 1, users: new Map([["grant-us011", { email: "grant-us011@example.com", displayName: "Grant", enabled: true, otpCredentials: [], requiredActions: new Set() }]]) };

    const grant = await service().grantCompanyRole("admin-us011", {
      userAccountId: userId,
      companyId: companyA,
      role: "approver",
      validFrom: "2026-08-03",
      validTo: "2026-12-31",
      note: "Temporary approver coverage",
    });
    const stored = await owner.query(
      "SELECT company_id, role, valid_from::text, valid_to::text FROM company_role_assignment WHERE id = $1",
      [grant.id],
    );
    expect(stored.rows).toEqual([{ company_id: companyA, role: "approver", valid_from: "2026-08-03", valid_to: "2026-12-31" }]);

    await expect(service().removeCompanyRole("admin-us011", {
      assignmentId: grant.id,
      companyId: companyB,
      note: "Wrong tenant removal",
    })).rejects.toMatchObject({ code: "cross_company_target" });
    await service().removeCompanyRole("admin-us011", {
      assignmentId: grant.id,
      companyId: companyA,
      note: "Coverage period cancelled",
    });
    const notes = await owner.query(
      "SELECT action, note FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at, action",
      [grant.id],
    );
    expect(notes.rows).toEqual([
      { action: "identity.company_role.removed", note: "Coverage period cancelled" },
      { action: "identity.company_role.granted", note: "Temporary approver coverage" },
    ]);
  });

  test("every mutation rejects a blank mandatory note and non-group-admin authority (kills trim/role-claim mutants)", async () => {
    state = { nextSubject: 1, users: new Map() };
    await expect(service().createUser("admin-us011", {
      email: "blank-note-us011@example.com",
      displayName: "Blank Note",
      globalRole: null,
      personId: null,
      note: "   ",
    })).rejects.toMatchObject({ code: "note_required" });
    expect(state.users.size).toBe(0);

    const ordinaryId = "00000000-0000-0000-0000-000000001126";
    await insertUser({ id: ordinaryId, email: "ordinary-us011@example.com", subject: "ordinary-us011", companyId: companyA });
    await expect(service().grantCompanyRole("ordinary-us011", {
      userAccountId: ordinaryId,
      companyId: companyA,
      role: "viewer",
      validFrom: null,
      validTo: null,
      note: "Self grant attempt",
    })).rejects.toMatchObject({ code: "forbidden" });
  });
});
