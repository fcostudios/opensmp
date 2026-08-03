import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import esMessages from "../../../messages/es-EC.json";
import { UsersRolesPanel } from "../../components/users/users-roles-panel";
import { renderUsersRolesPage } from "./users-roles-page";

import {
  createInMemoryKeycloakAdminClient,
  type InMemoryKeycloakAdminState,
} from "./keycloak-admin";
import {
  createUserAdminService,
} from "./user-admin-service";
import { createUserAdministrationRepository } from "./repository";
import { createManageUserActionHandlers } from "./actions/manage-users";
import { createAuthorizationRepository } from "./authorization";
import { createServerAuthorizationEntrypoints } from "./server-authorization";

const systemUserId = "00000000-0000-0000-0000-000000000001";
const actorId = "00000000-0000-0000-0000-000000001101";
const companyA = "00000000-0000-0000-0000-000000001111";
const companyB = "00000000-0000-0000-0000-000000001112";
const unauthorizedCompany = "00000000-0000-0000-0000-000000001119";
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
  test("server-action handlers parse, normalize, delegate, and revalidate every privileged mutation", async () => {
    state = { nextSubject: 81, users: new Map() };
    const revalidated: string[] = [];
    const handlers = createManageUserActionHandlers({
      actorSubject: async () => "admin-us011",
      revalidate: (path) => { revalidated.push(path); },
      service,
    });
    const form = (entries: Record<string, string>) => {
      const data = new FormData();
      for (const [name, value] of Object.entries(entries)) data.set(name, value);
      return data;
    };
    const actionPersonId = "00000000-0000-0000-0000-000000001181";
    await owner.query(
      `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
       VALUES ($1, 'action-person-us011@example.com', 'Action Person', $2, 'active', $3, $4)`,
      [actionPersonId, companyA, now, systemUserId],
    );

    await handlers.createUserAccount(form({
      email: "action-user-us011@example.com",
      globalRole: " group_admin ",
      personId: actionPersonId,
      note: "Created from account action",
    }));
    const created = await owner.query<{ id: string; global_role: string; person_id: string }>("SELECT id, global_role, person_id FROM user_account WHERE email = 'action-user-us011@example.com'");
    const userId = created.rows[0]!.id;
    expect(created.rows[0]!.global_role).toBe("group_admin");
    expect(created.rows[0]!.person_id).toBe(actionPersonId);
    expect(state.users.get("in-memory-user-81")).toMatchObject({ email: "action-user-us011@example.com", displayName: "action-user-us011@example.com" });
    const createdAudit = await owner.query(
      `SELECT company_id, after
       FROM audit_log
       WHERE entity_id = $1 AND action = 'identity.user.created'`,
      [userId],
    );
    expect(createdAudit.rows).toEqual([{
      company_id: companyA,
      after: {
        email: "action-user-us011@example.com",
        globalRole: "group_admin",
        idpSubject: "in-memory-user-81",
        personId: actionPersonId,
      },
    }]);

    await handlers.addCompanyRole(form({
      userAccountId: userId,
      companyId: companyA,
      role: "finance",
      validFrom: "2027-01-01",
      validTo: "2027-10-31",
      note: "Granted from role action",
    }));
    const assignment = await owner.query<{ id: string }>("SELECT id FROM company_role_assignment WHERE user_account_id = $1 AND role = 'finance'", [userId]);
    const assignmentId = assignment.rows[0]!.id;
    const financeDates = await owner.query("SELECT valid_from::text, valid_to::text FROM company_role_assignment WHERE id = $1", [assignmentId]);
    expect(financeDates.rows).toEqual([{ valid_from: "2027-01-01", valid_to: "2027-10-31" }]);
    await handlers.createUserAccount(form({
      email: "action-finance-us011@example.com",
      globalRole: "central_finance",
      personId: "",
      note: "Central finance action",
    }));
    const blobPerson = form({ email: "action-blob-us011@example.com", globalRole: "", note: "Binary person ignored" });
    blobPerson.set("personId", new Blob(["not-a-person"]));
    await handlers.createUserAccount(blobPerson);
    for (const role of ["approver", "viewer"] as const) {
      await handlers.addCompanyRole(form({
        userAccountId: userId,
        companyId: companyA,
        role,
        validFrom: "2027-02-01",
        validTo: "",
        note: `${role} action grant`,
      }));
    }
    await handlers.resetTwoFactor(form({ userAccountId: userId, note: "Reset from action" }));
    await handlers.removeCompanyRole(form({ assignmentId, companyId: companyA, note: "Removed from action" }));
    await handlers.disableUserAccount(form({ userAccountId: userId, companyId: companyA, note: "Disabled from action" }));

    expect(revalidated).toEqual(Array(9).fill("/usuarios"));
    expect(state.users.get("in-memory-user-81")).toMatchObject({ enabled: false, otpCredentials: [] });
    expect(state.users.get("in-memory-user-81")?.requiredActions).toEqual(new Set(["CONFIGURE_TOTP"]));
    const persisted = await owner.query("SELECT status FROM user_account WHERE id = $1", [userId]);
    expect(persisted.rows).toEqual([{ status: "disabled" }]);
    const removed = await owner.query("SELECT count(*)::int AS count FROM company_role_assignment WHERE id = $1", [assignmentId]);
    expect(removed.rows).toEqual([{ count: 0 }]);
  });

  test("server-action handlers reject invalid form contracts before invoking a mutation", async () => {
    state = { nextSubject: 91, users: new Map() };
    let actorCalls = 0;
    const handlers = createManageUserActionHandlers({
      actorSubject: async () => { actorCalls += 1; return "admin-us011"; },
      revalidate: () => { throw new Error("invalid input must not revalidate"); },
      service,
    });
    const invalid = new FormData();
    invalid.set("email", "not-an-email");
    invalid.set("globalRole", "invalid-role");
    invalid.set("personId", "invalid-person");
    invalid.set("note", " ");

    await expect(handlers.createUserAccount(invalid)).rejects.toMatchObject({ name: "ZodError" });
    expect(actorCalls).toBe(0);
    expect(state.users.size).toBe(0);
  });

  test("users-and-roles page composition enforces group-admin access and renders exact service results", async () => {
    state = { nextSubject: 101, users: new Map() };
    const subjects = await owner.query<{ email: string; idp_subject: string }>("SELECT email, idp_subject FROM user_account WHERE idp_subject IS NOT NULL");
    for (const row of subjects.rows) {
      state.users.set(row.idp_subject, { email: row.email, displayName: row.email, enabled: true, otpCredentials: [], requiredActions: new Set() });
    }
    const deny = () => { throw new Error("access-denied"); };
    await expect(renderUsersRolesPage({ authorization: null, locale: "es-EC", messages: esMessages, redirectToAccessDenied: deny, service: service() }))
      .rejects.toThrowError("access-denied");
    await expect(renderUsersRolesPage({ authorization: { globalRole: "central_finance", idpSubject: "admin-us011" }, locale: "es-EC", messages: esMessages, redirectToAccessDenied: deny, service: service() }))
      .rejects.toThrowError("access-denied");

    const page = await renderUsersRolesPage({
      authorization: { globalRole: "group_admin", idpSubject: "admin-us011" },
      locale: "es-EC",
      messages: esMessages,
      redirectToAccessDenied: deny,
      service: service(),
    });
    expect(page.type).toBe("main");
    expect(page.props.className).toBe("space-y-5 p-4 sm:p-6");
    const [header, panel] = page.props.children as Array<{ type: unknown; props: Record<string, unknown> }>;
    expect(header?.type).toBe("header");
    expect(panel?.type).toBe(UsersRolesPanel);
    expect(panel?.props).toMatchObject({ locale: "es-EC", labels: esMessages.usersRoles });
    expect((panel?.props.users as Array<{ email: string }>).map(({ email }) => email)).toContain("admin-us011@example.com");
    expect((panel?.props.companies as Array<{ id: string }>).map(({ id }) => id)).toEqual([companyA, companyB]);
    expect(panel?.props.actions).toEqual({
      createUser: expect.any(Function),
      disableUser: expect.any(Function),
      grantRole: expect.any(Function),
      removeRole: expect.any(Function),
      resetTwoFactor: expect.any(Function),
    });
  });

  test("server authorization entrypoints resolve each session and preserve real repository decisions", async () => {
    const repository = createAuthorizationRepository(
      drizzle(appPool, { schema }),
    );
    const authenticated = createServerAuthorizationEntrypoints({
      loadSession: async () => ({ user: { idpSubject: "admin-us011" } }),
      repository,
    });
    const anonymous = createServerAuthorizationEntrypoints({
      loadSession: async () => null,
      repository,
    });
    const missingUser = createServerAuthorizationEntrypoints({
      loadSession: async () => ({}),
      repository,
    });

    await expect(anonymous.loadCurrentLedgerAuthorization()).resolves.toBeNull();
    await expect(missingUser.loadCurrentLedgerAuthorization()).resolves.toBeNull();
    const missingUserDecision = await missingUser.authorizeCompanyRequest({
      companyId: companyA,
      capability: "company:read",
    });
    expect(missingUserDecision.ok).toBe(false);
    if (!missingUserDecision.ok) expect(missingUserDecision.response.status).toBe(401);
    const anonymousDecision = await anonymous.authorizeCompanyRequest({
      companyId: companyA,
      capability: "company:read",
    });
    expect(anonymousDecision.ok).toBe(false);
    if (!anonymousDecision.ok) expect(anonymousDecision.response.status).toBe(401);

    await expect(authenticated.loadCurrentLedgerAuthorization()).resolves.toMatchObject({
      idpSubject: "admin-us011",
      companyIds: [companyA, companyB],
      roles: ["group_admin"],
    });
    await expect(authenticated.loadLedgerAuthorizationForSubject(null)).resolves.toBeNull();
    await expect(authenticated.loadLedgerAuthorizationForSubject("admin-us011")).resolves.toMatchObject({
      idpSubject: "admin-us011",
      companyIds: [companyA, companyB],
      roles: ["group_admin"],
    });
    const allowed = await authenticated.authorizeCompanyRequest({
      companyId: companyA,
      capability: "company:read",
    });
    expect(allowed).toMatchObject({
      ok: true,
      authorization: {
        idpSubject: "admin-us011",
        companyIds: [companyA, companyB],
        roles: ["group_admin"],
      },
    });

    await authenticated.recordLedgerAuthorizationFailure({
      actorUserId: null,
      capability: "company:read",
      companyId: null,
      errorCode: "capability_forbidden",
    });
    const audit = await owner.query(
      `SELECT actor_user_id, company_id, after
       FROM audit_log
       WHERE action = 'authorization.denied'
         AND actor_user_id IS NULL
         AND company_id IS NULL
       ORDER BY occurred_at DESC
       LIMIT 1`,
    );
    expect(audit.rows).toEqual([{
      actor_user_id: null,
      company_id: null,
      after: { capability: "company:read", errorCode: "capability_forbidden" },
    }]);
  });

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

    state = {
      nextSubject: 1,
      users: new Map([
        ["read-a-us011", { email: "read-a-us011@example.com", displayName: "Read A", enabled: true, otpCredentials: [], requiredActions: new Set() }],
        ["read-b-us011", { email: "read-b-us011@example.com", displayName: "Read B", enabled: true, otpCredentials: [], requiredActions: new Set() }],
      ]),
    };
    expect((await repository.listUsers([companyA])).map(({ id }) => id)).toContain(userA);
    expect((await repository.listUsers([companyA])).map(({ id }) => id)).not.toContain(userB);
    expect([...new Set((await repository.listCompanyRoles([companyA])).map(({ companyId }) => companyId))]).toEqual([companyA]);
    expect((await repository.listCompanies([companyA])).map(({ id }) => id)).toEqual([companyA]);
    expect([...new Set((await service().listCompanyRoles("admin-us011")).map(({ companyId }) => companyId))]).toEqual([companyA, companyB]);
    expect((await service().listCompanies("admin-us011")).map(({ id }) => id)).toEqual([companyA, companyB]);
    expect(await service().listAvailablePeople("admin-us011")).toEqual([]);
  });

  test("create persists the returned idp_subject and exact mandatory audit note (kills discarded-subject/note mutants)", async () => {
    state = { nextSubject: 41, users: new Map() };
    const created = await service().createUser("admin-us011", {
      email: "  CREATED-US011@EXAMPLE.COM  ",
      displayName: "  Created User  ",
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
    expect(state.users.get("in-memory-user-41")).toMatchObject({
      displayName: "Created User",
      email: "created-us011@example.com",
    });
    const normalized = await owner.query("SELECT email FROM user_account WHERE id = $1", [created.id]);
    expect(normalized.rows).toEqual([{ email: "created-us011@example.com" }]);
    const audit = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id,
              before, after, note, occurred_at
       FROM audit_log WHERE entity_id = $1`,
      [created.id],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: actorId,
        action: "identity.user.created",
        entity_type: "UserAccount",
        entity_id: created.id,
        company_id: null,
        before: null,
        after: {
          email: "created-us011@example.com",
          globalRole: "central_finance",
          idpSubject: "in-memory-user-41",
          personId: null,
        },
        note: "Approved access request AR-41",
        occurred_at: now,
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
      `SELECT actor_user_id, action, entity_type, entity_id, company_id,
              before, after, note, occurred_at
       FROM audit_log WHERE entity_id = $1`,
      [userId],
    );
    expect(audit.rows).toEqual([{
      actor_user_id: actorId,
      action: "identity.user.two_factor_reset",
      entity_type: "UserAccount",
      entity_id: userId,
      company_id: null,
      before: { status: "active" },
      after: { twoFactorStatus: "pending" },
      note: "Phone replaced after loss",
      occurred_at: now,
    }]);
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
      companyId: unauthorizedCompany,
      note: "Wrong company target",
    })).rejects.toMatchObject({ code: "cross_company_target" });
    expect(state.users.get("scoped-us011")?.enabled).toBe(true);
    const row = await owner.query("SELECT status FROM user_account WHERE id = $1", [userId]);
    expect(row.rows).toEqual([{ status: "active" }]);

    await expect(service().disableUser("admin-us011", {
      userAccountId: userId,
      companyId: companyB,
      note: "Authorized company but mismatched target",
    })).rejects.toMatchObject({ code: "cross_company_target", name: "UserAdminError" });
    await expect(service().disableUser("admin-us011", {
      userAccountId: "00000000-0000-0000-0000-000000009999",
      companyId: companyA,
      note: "Missing user target",
    })).rejects.toMatchObject({ code: "target_not_found", name: "UserAdminError" });

    await service().disableUser("admin-us011", {
      userAccountId: userId,
      companyId: companyA,
      note: "Employment ended",
    });
    expect(state.users.get("scoped-us011")?.enabled).toBe(false);
    const disabled = await owner.query("SELECT status FROM user_account WHERE id = $1", [userId]);
    expect(disabled.rows).toEqual([{ status: "disabled" }]);
    const audit = await owner.query(
      `SELECT actor_user_id, action, entity_type, company_id, entity_id,
              before, after, note, occurred_at
       FROM audit_log WHERE entity_id = $1`,
      [userId],
    );
    expect(audit.rows).toEqual([{
      actor_user_id: actorId,
      action: "identity.user.disabled",
      entity_type: "UserAccount",
      company_id: companyA,
      entity_id: userId,
      before: { status: "active" },
      after: { status: "disabled" },
      note: "Employment ended",
      occurred_at: now,
    }]);
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
      "SELECT company_id, role, unique_grant, valid_from::text, valid_to::text FROM company_role_assignment WHERE id = $1",
      [grant.id],
    );
    expect(stored.rows).toEqual([{
      company_id: companyA,
      role: "approver",
      unique_grant: `${userId}:${companyA}:approver`,
      valid_from: "2026-08-03",
      valid_to: "2026-12-31",
    }]);

    const repository = createUserAdministrationRepository(drizzle(appPool, { schema }));
    await expect(repository.grantCompanyRole({
      actorUserId: actorId,
      companyId: unauthorizedCompany,
      note: "Missing company repository target",
      occurredAt: now,
      role: "viewer",
      userAccountId: userId,
      validFrom: null,
      validTo: null,
    })).rejects.toThrowError("cross_company_target");
    await expect(repository.grantCompanyRole({
      actorUserId: actorId,
      companyId: companyA,
      note: "Missing user repository target",
      occurredAt: now,
      role: "viewer",
      userAccountId: "00000000-0000-0000-0000-000000009997",
      validFrom: null,
      validTo: null,
    })).rejects.toThrowError("cross_company_target");

    await expect(service().removeCompanyRole("admin-us011", {
      assignmentId: grant.id,
      companyId: unauthorizedCompany,
      note: "Wrong tenant removal",
    })).rejects.toMatchObject({ code: "cross_company_target" });
    await service().removeCompanyRole("admin-us011", {
      assignmentId: grant.id,
      companyId: companyA,
      note: "Coverage period cancelled",
    });
    const notes = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id,
              before, after, note, occurred_at
       FROM audit_log WHERE entity_id = $1 ORDER BY action DESC`,
      [grant.id],
    );
    expect(notes.rows).toEqual([
      {
        actor_user_id: actorId,
        action: "identity.company_role.removed",
        entity_type: "CompanyRoleAssignment",
        entity_id: grant.id,
        company_id: companyA,
        before: {
          company_id: companyA,
          created_at: "2026-08-03T15:00:00+00:00",
          created_by: actorId,
          id: grant.id,
          role: "approver",
          unique_grant: `${userId}:${companyA}:approver`,
          user_account_id: userId,
          valid_from: "2026-08-03",
          valid_to: "2026-12-31",
        },
        after: null,
        note: "Coverage period cancelled",
        occurred_at: expect.any(Date),
      },
      {
        actor_user_id: actorId,
        action: "identity.company_role.granted",
        entity_type: "CompanyRoleAssignment",
        entity_id: grant.id,
        company_id: companyA,
        before: null,
        after: {
          role: "approver",
          userAccountId: userId,
          validFrom: "2026-08-03",
          validTo: "2026-12-31",
        },
        note: "Temporary approver coverage",
        occurred_at: now,
      },
    ]);

    await expect(service().grantCompanyRole("admin-us011", {
      userAccountId: userId,
      companyId: unauthorizedCompany,
      role: "viewer",
      validFrom: null,
      validTo: null,
      note: "Unauthorized tenant grant",
    })).rejects.toMatchObject({ code: "cross_company_target" });
    await expect(service().grantCompanyRole("admin-us011", {
      userAccountId: userId,
      companyId: companyA,
      role: "viewer",
      validFrom: "2026-12-31",
      validTo: "2026-08-03",
      note: "Invalid interval",
    })).rejects.toMatchObject({ code: "invalid_effective_dates" });
    const equalDateGrant = await service().grantCompanyRole("admin-us011", {
      userAccountId: userId,
      companyId: companyA,
      role: "viewer",
      validFrom: "2027-01-01",
      validTo: "2027-01-01",
      note: "One day assignment",
    });
    const equalDateStored = await owner.query(
      "SELECT valid_from::text, valid_to::text FROM company_role_assignment WHERE id = $1",
      [equalDateGrant.id],
    );
    expect(equalDateStored.rows).toEqual([{ valid_from: "2027-01-01", valid_to: "2027-01-01" }]);
    const openEndedGrant = await service().grantCompanyRole("admin-us011", {
      userAccountId: userId,
      companyId: companyA,
      role: "finance",
      validFrom: null,
      validTo: "2027-12-31",
      note: "Open start assignment",
    });
    const openEndedStored = await owner.query(
      "SELECT valid_from::text, valid_to::text FROM company_role_assignment WHERE id = $1",
      [openEndedGrant.id],
    );
    expect(openEndedStored.rows).toEqual([{ valid_from: null, valid_to: "2027-12-31" }]);
    const openFinishGrant = await service().grantCompanyRole("admin-us011", {
      userAccountId: userId,
      companyId: companyA,
      role: "approver",
      validFrom: "2028-01-01",
      validTo: null,
      note: "Open finish assignment",
    });
    const openFinishStored = await owner.query(
      "SELECT valid_from::text, valid_to::text FROM company_role_assignment WHERE id = $1",
      [openFinishGrant.id],
    );
    expect(openFinishStored.rows).toEqual([{ valid_from: "2028-01-01", valid_to: null }]);

    await expect(service().removeCompanyRole("admin-us011", {
      assignmentId: "00000000-0000-0000-0000-000000009998",
      companyId: companyA,
      note: "Missing assignment",
    })).rejects.toMatchObject({ code: "cross_company_target", name: "UserAdminError" });
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
