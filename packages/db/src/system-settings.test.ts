import { afterEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "./testing/postgres-container";

const fixtures: PostgresFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

describe("US-003 deterministic system defaults", () => {
  test("replays seed SQL idempotently without overwriting a customized default", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    const owner = await fixture.connectAsOwner();
    try {
      const seedSql = await readFile(
        new URL("./migrations/V20260725180001__system_settings.sql", import.meta.url),
        "utf8",
      );
      await owner.query(
        `UPDATE system_setting
         SET value = '"custom-ledger@corporativo.ec"'::jsonb
         WHERE key = 'notif_sender_email'`,
      );
      await owner.query(seedSql);
      await owner.query(seedSql);
      const actor = await owner.query<{
        email: string;
        idp_subject: string | null;
        status: string;
      }>(`
        SELECT email, idp_subject, status
        FROM user_account
        WHERE id = '00000000-0000-0000-0000-000000000001'
      `);
      const settings = await owner.query<{ key: string; value: string }>(`
        SELECT key, value::text AS value
        FROM system_setting
        ORDER BY key
      `);

      expect(actor.rows).toEqual([
        {
          email: "system@ledger.invalid",
          idp_subject: null,
          status: "disabled",
        },
      ]);
      expect(settings.rows).toEqual([
        { key: "default_language", value: '"es"' },
        { key: "notif_escalation_email", value: '"admin@corporativo.ec"' },
        { key: "notif_sender_email", value: '"custom-ledger@corporativo.ec"' },
      ]);
    } finally {
      await owner.end();
    }
  }, 150_000);
});
