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
