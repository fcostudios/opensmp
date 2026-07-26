import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { userAccount } from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import { withAudit } from "./with-audit";

const actorId = "00000000-0000-0000-0000-000000000811";
const rollbackActorId = "00000000-0000-0000-0000-000000000812";
const companyId = "00000000-0000-0000-0000-000000000813";
const changedAt = new Date("2026-07-25T20:15:00.000Z");

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
       ($1, 'audit.actor@corporativo.example', 'audit-actor', 'es', 'active', now()),
       ($2, 'audit.rollback@corporativo.example', 'audit-rollback', 'es', 'active', now())`,
    [actorId, rollbackActorId],
  );
  await owner.query(
    `INSERT INTO company
       (id, code, name, type, status, budget_monthly_usd, statement_language,
        created_at, created_by)
     VALUES ($1, 'AUD', 'Audit Company', 'internal', 'active', 100, 'es',
             now(), $2)`,
    [companyId, actorId],
  );
});

afterAll(async () => {
  await Promise.all([appPool.end(), owner.end()]);
  await fixture.stop();
}, 150_000);

describe("withAudit", () => {
  test("commits the mutation and exact evidence in one transaction", async () => {
    const database = drizzle(appPool, { schema });

    const value = await withAudit(
      database,
      async (transaction) => {
        await transaction
          .update(userAccount)
          .set({ uiLanguage: "en" })
          .where(eq(userAccount.id, actorId));
        return {
          value: "updated",
          audit: {
            actorUserId: actorId,
            action: "user_account.ui_language.updated",
            entityType: "UserAccount",
            entityId: actorId,
            companyId,
            note: "Preference requested by actor",
            before: { ui_language: "es" },
            after: { ui_language: "en" },
          },
        };
      },
      { occurredAt: changedAt },
    );

    expect(value).toBe("updated");
    const account = await owner.query(
      "SELECT ui_language FROM user_account WHERE id = $1",
      [actorId],
    );
    expect(account.rows).toEqual([{ ui_language: "en" }]);
    const evidence = await owner.query(
      `SELECT actor_user_id, action, entity_type, entity_id, company_id,
              note, before, after, occurred_at
       FROM audit_log
       WHERE entity_id = $1 AND action = 'user_account.ui_language.updated'`,
      [actorId],
    );
    expect(evidence.rows).toEqual([
      {
        actor_user_id: actorId,
        action: "user_account.ui_language.updated",
        entity_type: "UserAccount",
        entity_id: actorId,
        company_id: companyId,
        note: "Preference requested by actor",
        before: { ui_language: "es" },
        after: { ui_language: "en" },
        occurred_at: changedAt,
      },
    ]);
  });

  test("rolls back the domain mutation when the audit insert fails", async () => {
    const database = drizzle(appPool, { schema });
    await owner.query(`
      CREATE FUNCTION reject_shared_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.entity_id = '${rollbackActorId}'::uuid THEN
          RAISE EXCEPTION 'forced shared audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_shared_audit
        BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION reject_shared_audit();
    `);

    try {
      await expect(
        withAudit(database, async (transaction) => {
          await transaction
            .update(userAccount)
            .set({ uiLanguage: "en" })
            .where(eq(userAccount.id, rollbackActorId));
          return {
            value: undefined,
            audit: {
              actorUserId: rollbackActorId,
              action: "user_account.ui_language.updated",
              entityType: "UserAccount",
              entityId: rollbackActorId,
              companyId: null,
              note: null,
              before: { ui_language: "es" },
              after: { ui_language: "en" },
            },
          };
        }),
      ).rejects.toThrow("forced shared audit failure");

      const account = await owner.query(
        "SELECT ui_language FROM user_account WHERE id = $1",
        [rollbackActorId],
      );
      expect(account.rows).toEqual([{ ui_language: "es" }]);
    } finally {
      await owner.query(`
        DROP TRIGGER reject_shared_audit ON audit_log;
        DROP FUNCTION reject_shared_audit();
      `);
    }
  });

  test("writes no evidence when the domain mutation fails", async () => {
    const database = drizzle(appPool, { schema });
    const auditCountBefore = await owner.query(
      "SELECT count(*)::int AS count FROM audit_log",
    );

    await expect(
      withAudit(database, async () => {
        throw new Error("domain mutation rejected");
      }),
    ).rejects.toThrow("domain mutation rejected");

    const auditCountAfter = await owner.query(
      "SELECT count(*)::int AS count FROM audit_log",
    );
    expect(auditCountAfter.rows).toEqual(auditCountBefore.rows);
  });

  test("redacts secret fields recursively while retaining system and scope hints", async () => {
    const database = drizzle(appPool, { schema });
    const entityId = "00000000-0000-0000-0000-000000000814";

    await withAudit(
      database,
      async () => ({
        value: undefined,
        audit: {
          actorUserId: null,
          action: "credential.rotated",
          entityType: "IntegrationCredential",
          entityId,
          companyId,
          note: null,
          before: {
            password: "old",
            nested: { token: "token-old" },
            rawRequest: { authorization: "Bearer old", method: "POST" },
          },
          after: {
            secret: "new",
            encryptedSecret: "ciphertext",
            recipients: [
              { email: "safe@example.test", token: "array-token" },
            ],
            rawResponse: { authorization: "Bearer new", status: 201 },
          },
        },
      }),
      { occurredAt: changedAt },
    );

    const evidence = await owner.query(
      `SELECT actor_user_id, company_id, before, after
       FROM audit_log WHERE entity_id = $1`,
      [entityId],
    );
    expect(evidence.rows).toEqual([
      {
        actor_user_id: null,
        company_id: companyId,
        before: {
          password: "[REDACTED]",
          nested: { token: "[REDACTED]" },
          rawRequest: {
            authorization: "[REDACTED]",
            method: "POST",
          },
        },
        after: {
          secret: "[REDACTED]",
          encryptedSecret: "[REDACTED]",
          recipients: [
            {
              email: "safe@example.test",
              token: "[REDACTED]",
            },
          ],
          rawResponse: {
            authorization: "[REDACTED]",
            status: 201,
          },
        },
      },
    ]);
  });
});
