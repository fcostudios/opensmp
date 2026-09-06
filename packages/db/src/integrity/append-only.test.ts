import { afterEach, describe, expect, test } from "vitest";
import type pg from "pg";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "../testing/postgres-container";

const fixtures: PostgresFixture[] = [];
const systemUserId = "00000000-0000-0000-0000-000000000001";
const ids = {
  alertEvent: "00000000-0000-0000-0000-000000000301",
  alertRule: "00000000-0000-0000-0000-000000000302",
  assignment: "00000000-0000-0000-0000-000000000303",
  audit: "00000000-0000-0000-0000-000000000304",
  company: "00000000-0000-0000-0000-000000000305",
  grant: "00000000-0000-0000-0000-000000000306",
  licenseRequest: "00000000-0000-0000-0000-000000000307",
  licenseType: "00000000-0000-0000-0000-000000000308",
  person: "00000000-0000-0000-0000-000000000309",
  provisioning: "00000000-0000-0000-0000-000000000310",
  transition: "00000000-0000-0000-0000-000000000311",
  vendor: "00000000-0000-0000-0000-000000000312",
  vendorAccount: "00000000-0000-0000-0000-000000000313",
} as const;

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

async function seedAppendOnlyRows(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO company (id, name, code, type, status, created_at, created_by)
     VALUES ($1, 'Company', 'COMP-APPEND', 'internal', 'active', now(), $2)`,
    [ids.company, systemUserId],
  );
  await client.query(
    `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
     VALUES ($1, 'append.only@example.test', 'Append Only', $2, 'active', now(), $3)`,
    [ids.person, ids.company, systemUserId],
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
     VALUES ($1, 'REQ-APPEND', $2, $3, $4, $5, 'active', 'fixture', now(), $6)`,
    [
      ids.licenseRequest,
      ids.person,
      ids.company,
      ids.vendorAccount,
      ids.licenseType,
      systemUserId,
    ],
  );
  await client.query(
    `INSERT INTO license_assignment (id, person_id, company_id, vendor_account_id, license_type_id,
       started_on, source_kind, created_at, created_by)
     VALUES ($1, $2, $3, $4, $5, '2026-01-01', 'import', now(), $6)`,
    [
      ids.assignment,
      ids.person,
      ids.company,
      ids.vendorAccount,
      ids.licenseType,
      systemUserId,
    ],
  );
  await client.query(
    `INSERT INTO provisioning_action (id, request_id, vendor_account_id, kind, mode, status, created_at)
     VALUES ($1, $2, $3, 'invite', 'automated', 'pending', now())`,
    [ids.provisioning, ids.licenseRequest, ids.vendorAccount],
  );
  await client.query(
    `INSERT INTO alert_rule (id, type, scope_kind, company_id, channel, enabled, created_at, created_by)
     VALUES ($1, 'approval_aging', 'company', $2, 'email', true, now(), $3)`,
    [ids.alertRule, ids.company, systemUserId],
  );
  await client.query(
    `INSERT INTO alert_event (id, alert_rule_id, fired_at, notified)
     VALUES ($1, $2, now(), '{}'::jsonb)`,
    [ids.alertEvent, ids.alertRule],
  );
  await client.query(
    `INSERT INTO audit_log (id, action, entity_type, entity_id, occurred_at)
     VALUES ($1, 'fixture.created', 'Fixture', $2, now())`,
    [ids.audit, ids.company],
  );
  await client.query(
    `INSERT INTO request_transition (id, request_id, to_state, occurred_at)
     VALUES ($1, $2, 'active', now())`,
    [ids.transition, ids.licenseRequest],
  );
  await client.query(
    `INSERT INTO company_role_assignment (id, user_account_id, company_id, role, unique_grant, created_at, created_by)
     VALUES ($1, $2, $3, 'viewer', 'fixture-grant', now(), $2)`,
    [ids.grant, systemUserId, ids.company],
  );
}

describe("US-003 append-only runtime grants", () => {
  test("US-057 enforces immutable, sequential, account-bound connector evidence", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const correlation = "00000000-0000-0000-0000-000000000401";
    const otherAccount = "00000000-0000-0000-0000-000000000402";
    const otherCompany = "00000000-0000-0000-0000-000000000403";
    const otherRequest = "00000000-0000-0000-0000-000000000404";
    const otherAction = "00000000-0000-0000-0000-000000000405";
    const insert = (overrides: Record<string, unknown> = {}) => {
      const row = { vendor_account_id: ids.vendorAccount, provisioning_action_id: ids.provisioning,
        correlation_id: correlation, operation: "provision", attempt: 1, phase: "requested",
        classification: null, summary: "{}", occurred_at: "2026-09-06T12:00:00Z", ...overrides };
      return app.query(`INSERT INTO connector_call_observation (${Object.keys(row).join(",")})
        VALUES (${Object.keys(row).map((_, i) => `$${i + 1}`).join(",")}) RETURNING phase`, Object.values(row));
    };
    try {
      await seedAppendOnlyRows(owner);
      await owner.query(`INSERT INTO vendor_account (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
        VALUES ($1, $2, 'Other account', 'automated', 0, 'active', '2026-09-06', $3)`, [otherAccount, ids.vendor, systemUserId]);
      // Removing any individual guard permits a specific invalid row in this matrix.
      for (const invalid of [
        { attempt: 0 }, { attempt: 2 }, { phase: "succeeded", classification: "success" },
        { classification: "success" }, { summary: "[]" }, { summary: "null" },
        { operation: "sync_members" }, { vendor_account_id: otherAccount },
      ]) await expect(insert(invalid)).rejects.toMatchObject({ code: "23514" });
      expect((await insert()).rows).toEqual([{ phase: "requested" }]);
      for (const invalid of [
        { attempt: 3 }, { attempt: 2, operation: "deprovision" },
        { attempt: 2, provisioning_action_id: null },
        { attempt: 2, provisioning_action_id: null, vendor_account_id: otherAccount },
        { phase: "succeeded", classification: null },
        { phase: "succeeded", classification: "provider_error" },
        { phase: "failed", classification: "success" },
        { phase: "failed", classification: "unknown" },
      ]) await expect(insert(invalid)).rejects.toMatchObject({ code: "23514" });
      await expect(insert()).rejects.toMatchObject({ code: "23514" });
      expect((await insert({ phase: "failed", classification: "rate_limited" })).rows).toEqual([{ phase: "failed" }]);
      await expect(insert({ phase: "succeeded", classification: "success" })).rejects.toMatchObject({ code: "23514" });
      expect((await insert({ attempt: 2 })).rowCount).toBe(1);
      expect((await insert({ attempt: 2, phase: "succeeded", classification: "success" })).rowCount).toBe(1);
      expect((await insert({ correlation_id: otherAccount, operation: "sync_cost", provisioning_action_id: null })).rowCount).toBe(1);
      await owner.query(`INSERT INTO company (id, name, code, type, status, created_at, created_by)
        VALUES ($1, 'Other company', 'COMP-OTHER', 'internal', 'active', '2026-09-06', $2)`, [otherCompany, systemUserId]);
      await owner.query(`INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
        VALUES ($1, 'other@example.test', 'Other', $1, 'active', '2026-09-06', $2)`, [otherCompany, systemUserId]);
      await owner.query(`INSERT INTO license_request (id, request_no, person_id, company_id, vendor_account_id,
        license_type_id, state, justification, created_at, created_by)
        VALUES ($1, 'REQ-OTHER', $2, $2, $3, $4, 'active', 'fixture', '2026-09-06', $5)`,
      [otherRequest, otherCompany, otherAccount, ids.licenseType, systemUserId]);
      await owner.query(`INSERT INTO provisioning_action (id, request_id, vendor_account_id, kind, mode, status, created_at)
        VALUES ($1, $2, $3, 'invite', 'automated', 'pending', '2026-09-06')`, [otherAction, otherRequest, otherAccount]);
      await expect(insert({ correlation_id: otherCompany, provisioning_action_id: otherAction })).rejects.toMatchObject({ code: "23514" });
      expect((await insert({ correlation_id: otherCompany, provisioning_action_id: otherAction, vendor_account_id: otherAccount })).rowCount).toBe(1);
      const attributed = await app.query(`SELECT DISTINCT o.correlation_id FROM connector_call_observation o
        JOIN provisioning_action a ON a.id = o.provisioning_action_id
        JOIN license_request r ON r.id = a.request_id WHERE r.company_id = $1`, [ids.company]);
      expect(attributed.rows).toEqual([{ correlation_id: correlation }]);
      expect((await app.query(`SELECT DISTINCT o.correlation_id FROM connector_call_observation o
        JOIN provisioning_action a ON a.id = o.provisioning_action_id
        JOIN license_request r ON r.id = a.request_id WHERE r.company_id = $1`, [otherCompany])).rows).toEqual([{ correlation_id: otherCompany }]);

      // A terminal waits for an in-flight requested transaction, then sees its commit.
      await owner.query("BEGIN");
      await owner.query(`INSERT INTO connector_call_observation (vendor_account_id, provisioning_action_id,
        correlation_id, operation, attempt, phase, summary, occurred_at)
        VALUES ($1, $2, $3, 'provision', 3, 'requested', '{}', '2026-09-06')`, [ids.vendorAccount, ids.provisioning, correlation]);
      const append = insert({ attempt: 3, phase: "succeeded", classification: "success" });
      try {
        const pid = (await owner.query(`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND usename = 'ledger_app' AND pid <> pg_backend_pid()`)).rows[0]?.pid;
        expect(pid).toBeTypeOf("number");
        await expect.poll(async () => (await owner.query(`SELECT count(*)::int AS count FROM pg_locks
          WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`, [pid])).rows[0]?.count).toBe(1);
      } finally {
        await owner.query("COMMIT");
      }
      expect((await append).rows).toEqual([{ phase: "succeeded" }]);
      for (const statement of ["UPDATE connector_call_observation SET summary = '{}'", "DELETE FROM connector_call_observation"]) {
        await expect(app.query(statement)).rejects.toMatchObject({ code: "42501" });
        await expect(owner.query(statement)).rejects.toMatchObject({ code: "55000" });
      }
      await expect(app.query("TRUNCATE connector_call_observation")).rejects.toMatchObject({ code: "42501" });
      expect((await app.query(`SELECT attempt, phase FROM connector_call_observation WHERE correlation_id = $1 ORDER BY attempt, phase`, [correlation])).rows).toEqual([
        { attempt: 1, phase: "requested" }, { attempt: 1, phase: "failed" },
        { attempt: 2, phase: "requested" }, { attempt: 2, phase: "succeeded" },
        { attempt: 3, phase: "requested" }, { attempt: 3, phase: "succeeded" },
      ]);
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("gives ledger_app only the documented append-only mutations", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    try {
      await seedAppendOnlyRows(owner);

      await expect(
        app.query("UPDATE audit_log SET note = 'tampered' WHERE id = $1", [ids.audit]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("DELETE FROM audit_log WHERE id = $1", [ids.audit]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("UPDATE request_transition SET note = 'tampered' WHERE id = $1", [ids.transition]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("DELETE FROM request_transition WHERE id = $1", [ids.transition]),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        app.query("UPDATE license_assignment SET company_id = $1 WHERE id = $2", [ids.company, ids.assignment]),
      ).rejects.toMatchObject({ code: "42501" });
      const assignmentClose = await app.query(
        "UPDATE license_assignment SET ended_on = '2026-01-31', end_reason = 'inactive' WHERE id = $1",
        [ids.assignment],
      );
      expect(assignmentClose.rowCount).toBe(1);
      const assignmentState = await app.query<{
        ended_on: Date;
        end_reason: string;
      }>(
        "SELECT ended_on, end_reason FROM license_assignment WHERE id = $1",
        [ids.assignment],
      );
      expect(assignmentState.rows).toHaveLength(1);
      expect(assignmentState.rows[0]?.end_reason).toBe("inactive");
      expect(assignmentState.rows[0]?.ended_on.toISOString().slice(0, 10)).toBe(
        "2026-01-31",
      );

      await expect(
        app.query("UPDATE provisioning_action SET raw_response = '{}'::jsonb WHERE id = $1", [ids.provisioning]),
      ).rejects.toMatchObject({ code: "42501" });
      const provisioningAdvance = await app.query(
        "UPDATE provisioning_action SET status = 'sent', sent_at = now() WHERE id = $1",
        [ids.provisioning],
      );
      expect(provisioningAdvance.rowCount).toBe(1);
      await expect(
        app.query<{ status: string; sent_at: Date | null }>(
          "SELECT status, sent_at FROM provisioning_action WHERE id = $1",
          [ids.provisioning],
        ),
      ).resolves.toMatchObject({ rows: [{ status: "sent", sent_at: expect.any(Date) }] });

      await expect(
        app.query("UPDATE alert_event SET notified = '{}'::jsonb WHERE id = $1", [ids.alertEvent]),
      ).rejects.toMatchObject({ code: "42501" });
      const alertAcknowledgement = await app.query(
        "UPDATE alert_event SET acknowledged_by = $1, acknowledged_at = now() WHERE id = $2",
        [systemUserId, ids.alertEvent],
      );
      expect(alertAcknowledgement.rowCount).toBe(1);
      await expect(
        app.query<{ acknowledged_by: string; acknowledged_at: Date | null }>(
          "SELECT acknowledged_by, acknowledged_at FROM alert_event WHERE id = $1",
          [ids.alertEvent],
        ),
      ).resolves.toMatchObject({
        rows: [{ acknowledged_by: systemUserId, acknowledged_at: expect.any(Date) }],
      });

      await expect(
        app.query("DELETE FROM company WHERE id = $1", [ids.company]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("DELETE FROM license_assignment WHERE id = $1", [ids.assignment]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("DELETE FROM provisioning_action WHERE id = $1", [ids.provisioning]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("DELETE FROM alert_event WHERE id = $1", [ids.alertEvent]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("DELETE FROM company_role_assignment WHERE id = $1", [ids.grant]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM company_role_assignment WHERE id = $1",
          [ids.grant],
        ),
      ).resolves.toMatchObject({ rows: [{ count: "1" }] });
    } finally {
      await Promise.all([app.end(), owner.end()]);
    }
  }, 150_000);

  test("still blocks owner-side mutation of the two immutable event logs", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    try {
      await seedAppendOnlyRows(owner);
      await expect(
        owner.query("UPDATE audit_log SET note = 'tampered' WHERE id = $1", [ids.audit]),
      ).rejects.toMatchObject({ code: "P0001" });
      await expect(
        owner.query("DELETE FROM request_transition WHERE id = $1", [ids.transition]),
      ).rejects.toMatchObject({ code: "P0001" });
    } finally {
      await owner.end();
    }
  }, 150_000);
});
