import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";

import {
  AUTH_TEST_IDENTITIES,
  seedAuthUsers,
} from "./seed-auth-users";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "./postgres-container";

let fixture: PostgresFixture;
let owner: pg.Client;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
}, 150_000);

afterAll(async () => {
  await owner.end();
  await fixture.stop();
}, 150_000);

test("seeds deterministic Ledger authorization without credential material and is idempotent", async () => {
  await seedAuthUsers(owner);
  await seedAuthUsers(owner);

  const accounts = await owner.query(`
    SELECT email, idp_subject, global_role, status,
           password_hash, totp_secret_encrypted
    FROM user_account
    WHERE email LIKE '%@auth.test'
    ORDER BY email
  `);
  expect(accounts.rows).toHaveLength(AUTH_TEST_IDENTITIES.length);
  expect(
    accounts.rows.every(
      ({ password_hash, totp_secret_encrypted }) =>
        password_hash === null && totp_secret_encrypted === null,
    ),
  ).toBe(true);
  expect(
    accounts.rows.find(({ email }) => email === "group-admin@auth.test"),
  ).toMatchObject({
    idp_subject: null,
    global_role: "group_admin",
    status: "active",
  });
  expect(
    accounts.rows.find(({ email }) => email === "disabled@auth.test"),
  ).toMatchObject({ status: "disabled" });

  const grants = await owner.query(`
    SELECT user_account.email, company_role_assignment.role
    FROM company_role_assignment
    JOIN user_account
      ON user_account.id = company_role_assignment.user_account_id
    WHERE user_account.email LIKE '%@auth.test'
    ORDER BY user_account.email, company_role_assignment.role
  `);
  expect(grants.rows).toEqual([
    { email: "approver@auth.test", role: "approver" },
    { email: "company-finance@auth.test", role: "finance" },
    { email: "viewer@auth.test", role: "viewer" },
  ]);
});
