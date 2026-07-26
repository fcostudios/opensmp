import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import {
  createLocaleService,
  LocaleUpdateError,
} from "./locale";

const actorId = "00000000-0000-0000-0000-000000000681";
const otherId = "00000000-0000-0000-0000-000000000682";
const disabledId = "00000000-0000-0000-0000-000000000683";
const rollbackActorId = "00000000-0000-0000-0000-000000000684";
const actorCompanyId = "00000000-0000-0000-0000-000000000685";
const actorPersonId = "00000000-0000-0000-0000-000000000686";
const changedAt = new Date("2026-07-25T18:30:00.000Z");

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  appPool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(
    `INSERT INTO user_account
       (id, email, idp_subject, ui_language, status, created_at)
     VALUES
       ($1, 'locale.actor@corporativo.example', 'locale-actor', NULL, 'active', now()),
       ($2, 'locale.other@corporativo.example', 'locale-other', 'es', 'active', now()),
       ($3, 'locale.disabled@corporativo.example', 'locale-disabled', 'es', 'disabled', now()),
       ($4, 'locale.rollback@corporativo.example', 'locale-rollback', NULL, 'active', now())`,
    [actorId, otherId, disabledId, rollbackActorId],
  );
  await owner.query(
    `INSERT INTO company
       (id, name, code, type, status, budget_monthly_usd,
        statement_language, created_at, created_by)
     VALUES ($1, 'Locale Company', 'LOC', 'internal', 'active', 100,
             'es', now(), $2)`,
    [actorCompanyId, actorId],
  );
  await owner.query(
    `INSERT INTO person
       (id, email, full_name, company_id, status, created_at, created_by)
     VALUES ($1, 'locale.actor@corporativo.example', 'Locale Actor',
             $2, 'active', now(), $3)`,
    [actorPersonId, actorCompanyId, actorId],
  );
  await owner.query(
    "UPDATE user_account SET person_id = $1 WHERE id = $2",
    [actorPersonId, actorId],
  );
});

afterAll(async () => {
  await Promise.all([appPool.end(), owner.end()]);
  await fixture.stop();
}, 150_000);

describe("locale service", () => {
  test("resolves a null user preference through the validated system setting", async () => {
    await owner.query(
      `UPDATE system_setting SET value = '"en"'::jsonb
       WHERE key = 'default_language'`,
    );
    const service = createLocaleService(drizzle(appPool, { schema }));

    await expect(service.resolveLocale(null)).resolves.toBe("en-US");
    await owner.query(
      `UPDATE system_setting SET value = '"invalid"'::jsonb
       WHERE key = 'default_language'`,
    );
    await expect(service.resolveLocale(null)).resolves.toBe("es-EC");
  });

  test("persists only the actor and appends the exact before/after audit atomically", async () => {
    const service = createLocaleService(drizzle(appPool, { schema }));

    await service.updateLocale(actorId, { locale: "en" }, changedAt);

    const accounts = await owner.query(
      `SELECT id, ui_language FROM user_account WHERE id IN ($1, $2) ORDER BY id`,
      [actorId, otherId],
    );
    expect(accounts.rows).toEqual([
      { id: actorId, ui_language: "en" },
      { id: otherId, ui_language: "es" },
    ]);
    const audit = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id,
              before, after, occurred_at
       FROM audit_log
       WHERE action = 'user_account.ui_language.updated'
         AND actor_user_id = $1`,
      [actorId],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: actorId,
        action: "user_account.ui_language.updated",
        entity_type: "UserAccount",
        entity_id: actorId,
        company_id: actorCompanyId,
        before: { ui_language: null },
        after: { ui_language: "en" },
        occurred_at: changedAt,
      },
    ]);
  });

  test("rejects an unauthenticated mutation without changing data or audit", async () => {
    const service = createLocaleService(drizzle(appPool, { schema }));
    const before = await owner.query(
      `SELECT ui_language FROM user_account WHERE id = $1`,
      [otherId],
    );
    const auditBefore = await owner.query(
      `SELECT count(*)::int AS count FROM audit_log
       WHERE action = 'user_account.ui_language.updated'`,
    );

    await expect(
      service.updateLocale(null, { locale: "en" }, changedAt),
    ).rejects.toEqual(new LocaleUpdateError("unauthorized"));

    const after = await owner.query(
      `SELECT ui_language FROM user_account WHERE id = $1`,
      [otherId],
    );
    const auditAfter = await owner.query(
      `SELECT count(*)::int AS count FROM audit_log
       WHERE action = 'user_account.ui_language.updated'`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(auditAfter.rows).toEqual(auditBefore.rows);
  });

  test("rejects a disabled actor without changing its preference or appending audit", async () => {
    const service = createLocaleService(drizzle(appPool, { schema }));
    const auditBefore = await owner.query(
      `SELECT count(*)::int AS count FROM audit_log
       WHERE action = 'user_account.ui_language.updated'`,
    );

    await expect(
      service.updateLocale(disabledId, { locale: "en" }, changedAt),
    ).rejects.toEqual(new LocaleUpdateError("account_unavailable"));

    const disabled = await owner.query(
      `SELECT ui_language FROM user_account WHERE id = $1`,
      [disabledId],
    );
    const auditAfter = await owner.query(
      `SELECT count(*)::int AS count FROM audit_log
       WHERE action = 'user_account.ui_language.updated'`,
    );
    expect(disabled.rows).toEqual([{ ui_language: "es" }]);
    expect(auditAfter.rows).toEqual(auditBefore.rows);
  });

  test("rolls back the preference update when the audit insert fails", async () => {
    const service = createLocaleService(drizzle(appPool, { schema }));
    await owner.query(`
      CREATE FUNCTION reject_locale_update_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'user_account.ui_language.updated'
           AND NEW.entity_id = '${rollbackActorId}'::uuid THEN
          RAISE EXCEPTION 'forced locale audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_locale_update_audit
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION reject_locale_update_audit();
    `);

    try {
      await expect(
        service.updateLocale(rollbackActorId, { locale: "en" }, changedAt),
      ).rejects.toThrow("forced locale audit failure");

      const persisted = await owner.query(
        `SELECT ui_language FROM user_account WHERE id = $1`,
        [rollbackActorId],
      );
      const audit = await owner.query(
        `SELECT id FROM audit_log
         WHERE action = 'user_account.ui_language.updated'
           AND entity_id = $1`,
        [rollbackActorId],
      );
      expect(persisted.rows).toEqual([{ ui_language: null }]);
      expect(audit.rows).toEqual([]);
    } finally {
      await owner.query(`
        DROP TRIGGER IF EXISTS reject_locale_update_audit ON audit_log;
        DROP FUNCTION IF EXISTS reject_locale_update_audit();
      `);
    }
  });
});
