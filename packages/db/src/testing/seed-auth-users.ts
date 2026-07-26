import type pg from "pg";

export const AUTH_TEST_COMPANY_ID =
  "20000000-0000-0000-0000-000000000451";

export const AUTH_TEST_IDENTITIES = [
  {
    id: "20000000-0000-0000-0000-000000000001",
    idpSubject: null,
    email: "employee@auth.test",
    globalRole: null,
    status: "active",
  },
  {
    id: "20000000-0000-0000-0000-000000000002",
    idpSubject: null,
    email: "approver@auth.test",
    globalRole: null,
    status: "active",
  },
  {
    id: "20000000-0000-0000-0000-000000000003",
    idpSubject: null,
    email: "company-finance@auth.test",
    globalRole: null,
    status: "active",
  },
  {
    id: "20000000-0000-0000-0000-000000000004",
    idpSubject: null,
    email: "central-finance@auth.test",
    globalRole: "central_finance",
    status: "active",
  },
  {
    id: "20000000-0000-0000-0000-000000000005",
    idpSubject: null,
    email: "group-admin@auth.test",
    globalRole: "group_admin",
    status: "active",
  },
  {
    id: "20000000-0000-0000-0000-000000000006",
    idpSubject: null,
    email: "viewer@auth.test",
    globalRole: null,
    status: "active",
  },
  {
    id: "20000000-0000-0000-0000-000000000007",
    idpSubject: null,
    email: "disabled@auth.test",
    globalRole: null,
    status: "disabled",
  },
  {
    id: "20000000-0000-0000-0000-000000000008",
    idpSubject: null,
    email: "admin-without-totp@auth.test",
    globalRole: "group_admin",
    status: "active",
  },
  {
    id: "20000000-0000-0000-0000-000000000009",
    idpSubject: null,
    email: "admin-candidate@auth.test",
    globalRole: null,
    status: "active",
  },
  {
    id: "20000000-0000-0000-0000-000000000010",
    idpSubject: null,
    email: "audit-admin@auth.test",
    globalRole: "group_admin",
    status: "active",
  },
] as const;

type QueryClient = Pick<pg.Client, "query">;

/** Seed authorization only in a disposable test database; never in migrations. */
export async function seedAuthUsers(client: QueryClient): Promise<void> {
  await client.query(`
    WITH seeded_company AS (
      INSERT INTO company (
        id, name, code, type, status, created_at, created_by
      ) VALUES (
        '${AUTH_TEST_COMPANY_ID}',
        'Authentication Test Company',
        'AUTH-TEST',
        'internal',
        'active',
        now(),
        '00000000-0000-0000-0000-000000000001'
      )
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    ),
    seeded_users AS (
      INSERT INTO user_account (
        id, email, idp_subject, global_role, status, created_at
      ) VALUES
        ('20000000-0000-0000-0000-000000000001', 'employee@auth.test',
         NULL, NULL, 'active', now()),
        ('20000000-0000-0000-0000-000000000002', 'approver@auth.test',
         NULL, NULL, 'active', now()),
        ('20000000-0000-0000-0000-000000000003', 'company-finance@auth.test',
         NULL, NULL, 'active', now()),
        ('20000000-0000-0000-0000-000000000004', 'central-finance@auth.test',
         NULL, 'central_finance', 'active', now()),
        ('20000000-0000-0000-0000-000000000005', 'group-admin@auth.test',
         NULL, 'group_admin', 'active', now()),
        ('20000000-0000-0000-0000-000000000006', 'viewer@auth.test',
         NULL, NULL, 'active', now()),
        ('20000000-0000-0000-0000-000000000007', 'disabled@auth.test',
         NULL, NULL, 'disabled', now()),
        ('20000000-0000-0000-0000-000000000008', 'admin-without-totp@auth.test',
         NULL, 'group_admin', 'active', now()),
        ('20000000-0000-0000-0000-000000000009', 'admin-candidate@auth.test',
         NULL, NULL, 'active', now()),
        ('20000000-0000-0000-0000-000000000010', 'audit-admin@auth.test',
         NULL, 'group_admin', 'active', now())
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        idp_subject = COALESCE(user_account.idp_subject, EXCLUDED.idp_subject),
        global_role = EXCLUDED.global_role,
        status = EXCLUDED.status
      RETURNING id
    )
    INSERT INTO company_role_assignment (
      id, user_account_id, company_id, role, unique_grant, created_at, created_by
    ) VALUES
      ('20000000-0000-0000-0000-000000000102',
       '20000000-0000-0000-0000-000000000002',
       '${AUTH_TEST_COMPANY_ID}', 'approver', 'auth-test-approver', now(),
       '00000000-0000-0000-0000-000000000001'),
      ('20000000-0000-0000-0000-000000000103',
       '20000000-0000-0000-0000-000000000003',
       '${AUTH_TEST_COMPANY_ID}', 'finance', 'auth-test-finance', now(),
       '00000000-0000-0000-0000-000000000001'),
      ('20000000-0000-0000-0000-000000000106',
       '20000000-0000-0000-0000-000000000006',
       '${AUTH_TEST_COMPANY_ID}', 'viewer', 'auth-test-viewer', now(),
       '00000000-0000-0000-0000-000000000001')
    ON CONFLICT (id) DO UPDATE SET
      user_account_id = EXCLUDED.user_account_id,
      company_id = EXCLUDED.company_id,
      role = EXCLUDED.role,
      unique_grant = EXCLUDED.unique_grant;

    INSERT INTO person (
      id, email, full_name, company_id, status, created_at, created_by
    ) VALUES (
      '20000000-0000-0000-0000-000000000201',
      'employee@auth.test',
      'Elena Employee',
      '${AUTH_TEST_COMPANY_ID}',
      'active',
      now(),
      '00000000-0000-0000-0000-000000000001'
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      company_id = EXCLUDED.company_id,
      status = EXCLUDED.status;

    UPDATE user_account
    SET person_id = '20000000-0000-0000-0000-000000000201'
    WHERE id = '20000000-0000-0000-0000-000000000001'
  `);
}
