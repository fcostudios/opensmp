import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import { auditLog, userAccount } from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import { withAudit, verifyRecordedAuditReceipt, type RecordedAuditReceipt } from "./with-audit";

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
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);

    try {
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
      expect(emitWarning).not.toHaveBeenCalled();
    } finally {
      emitWarning.mockRestore();
    }
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

  test("returns the committed result and handles a rejected post-commit callback once", async () => {
    const database = drizzle(appPool, { schema });
    const observed: Array<{ auditCount: number; locale: string }> = [];
    const onAfterCommitFailure = vi.fn(async () => undefined);

    await expect(
      withAudit(
        database,
        async (transaction) => {
          await transaction
            .update(userAccount)
            .set({ uiLanguage: "en" })
            .where(eq(userAccount.id, actorId));
          return {
            value: "committed",
            audit: {
              actorUserId: actorId,
              action: "user_account.post_commit_test",
              entityType: "UserAccount",
              entityId: actorId,
              companyId,
              note: null,
              before: { ui_language: "es" },
              after: { ui_language: "en" },
            },
          };
        },
        {
          occurredAt: changedAt,
          afterCommit: async () => {
            const state = await owner.query<{
              audit_count: number;
              ui_language: string;
            }>(
              `SELECT account.ui_language,
                      count(audit.id)::int AS audit_count
               FROM user_account account
               LEFT JOIN audit_log audit
                 ON audit.entity_id=account.id
                AND audit.action='user_account.post_commit_test'
               WHERE account.id=$1
               GROUP BY account.ui_language`,
              [actorId],
            );
            observed.push({
              auditCount: state.rows[0]!.audit_count,
              locale: state.rows[0]!.ui_language,
            });
            throw new Error("post-commit delivery failed");
          },
          onAfterCommitFailure,
        },
      ),
    ).resolves.toBe("committed");

    expect(observed).toEqual([{ auditCount: 1, locale: "en" }]);
    expect(onAfterCommitFailure).toHaveBeenCalledOnce();
    expect(onAfterCommitFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: "post-commit delivery failed" }),
      "committed",
    );
    const committed = await owner.query(
      "SELECT ui_language FROM user_account WHERE id=$1",
      [actorId],
    );
    expect(committed.rows).toEqual([{ ui_language: "en" }]);
  });

  test("runs a successful post-commit callback once and does not invoke its failure handler", async () => {
    const database = drizzle(appPool, { schema });
    const afterCommit = vi.fn(async () => undefined);
    const onAfterCommitFailure = vi.fn(async () => undefined);

    await expect(
      withAudit(
        database,
        async () => ({
          value: "committed",
          audit: {
            actorUserId: actorId,
            action: "user_account.post_commit_success_test",
            entityType: "UserAccount",
            entityId: actorId,
            companyId,
            note: null,
            before: null,
            after: null,
          },
        }),
        {
          occurredAt: changedAt,
          afterCommit,
          onAfterCommitFailure,
        },
      ),
    ).resolves.toBe("committed");

    expect(afterCommit).toHaveBeenCalledOnce();
    expect(afterCommit).toHaveBeenCalledWith("committed");
    expect(onAfterCommitFailure).not.toHaveBeenCalled();
  });

  test("contains and reports a post-commit failure-handler rejection", async () => {
    const database = drizzle(appPool, { schema });
    const reportFailure = vi.fn();

    await expect(
      withAudit(
        database,
        async () => ({
          value: "committed",
          audit: {
            actorUserId: actorId,
            action: "user_account.post_commit_handler_test",
            entityType: "UserAccount",
            entityId: actorId,
            companyId,
            note: null,
            before: null,
            after: null,
          },
        }),
        {
          occurredAt: changedAt,
          afterCommit: async () => {
            throw new Error("callback failed");
          },
          onAfterCommitFailure: async () => {
            throw new Error("handler failed");
          },
          reportAfterCommitFailureHandlerError: reportFailure,
        },
      ),
    ).resolves.toBe("committed");

    expect(reportFailure).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledWith(
      "POST_COMMIT_FAILURE_HANDLER_FAILED",
    );
  });

  test("reports a failure-handler rejection through the default sanitized warning seam", async () => {
    const database = drizzle(appPool, { schema });
    const emitWarning = vi
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);

    try {
      await expect(
        withAudit(
          database,
          async () => ({
            value: "committed",
            audit: {
              actorUserId: actorId,
              action: "user_account.post_commit_default_report_test",
              entityType: "UserAccount",
              entityId: actorId,
              companyId,
              note: null,
              before: null,
              after: null,
            },
          }),
          {
            occurredAt: changedAt,
            afterCommit: async () => {
              throw new Error("callback failed");
            },
            onAfterCommitFailure: async () => {
              throw new Error("handler failed");
            },
          },
        ),
      ).resolves.toBe("committed");
      expect(emitWarning).toHaveBeenCalledOnce();
      expect(emitWarning).toHaveBeenCalledWith(
        "POST_COMMIT_FAILURE_HANDLER_FAILED",
      );
    } finally {
      emitWarning.mockRestore();
    }
  });

  test("rolls back the domain mutation when the audit insert fails", async () => {
    const database = drizzle(appPool, { schema });
    const afterCommit = vi.fn(async () => undefined);
    const onAfterCommitFailure = vi.fn(async () => undefined);
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
        withAudit(
          database,
          async (transaction) => {
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
          },
          { afterCommit, onAfterCommitFailure },
        ),
      ).rejects.toThrow("forced shared audit failure");

      const account = await owner.query(
        "SELECT ui_language FROM user_account WHERE id = $1",
        [rollbackActorId],
      );
      expect(account.rows).toEqual([{ ui_language: "es" }]);
      expect(afterCommit).not.toHaveBeenCalled();
      expect(onAfterCommitFailure).not.toHaveBeenCalled();
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


describe("withAudit recorded receipts", () => {
  const receiptEntity = "00000000-0000-0000-0000-000000000815";
  const expected = {
    actorUserId: actorId, action: "offboarding.removal_confirmed",
    entityType: "ProvisioningAction", entityId: receiptEntity, companyId,
    after: { completionId: "original", replayed: false, actorUserId: actorId },
    occurredAt: changedAt,
  };
  beforeAll(async () => {
    await drizzle(owner, { schema }).insert(auditLog).values({ ...expected, note: null, before: null });
  });

  test("commits nested mutation and one exact receipt, then replays without duplicate evidence", async () => {
    const database = drizzle(appPool, { schema });
    const observed: string[] = [];
    const freshExpected = { ...expected, entityId: "00000000-0000-0000-0000-000000000816" };
    const value = await withAudit(database, async transaction => {
      await transaction.transaction(async nested => {
        await nested.update(userAccount).set({ uiLanguage: "en" }).where(eq(userAccount.id, actorId));
        await nested.insert(auditLog).values({ ...freshExpected, note: null, before: null });
      });
      return { value: "original", audit: await verifyRecordedAuditReceipt(transaction, freshExpected) };
    }, {
      afterCommit: async value => {
        const committed = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [actorId]);
        expect(committed.rows).toEqual([{ ui_language: "en" }]);
        observed.push(value);
      }, onAfterCommitFailure: async error => { throw error; },
    });
    expect(value).toBe("original");
    expect(observed).toEqual(["original"]);
    await expect(withAudit(database, async transaction => ({
      value: "original", audit: await verifyRecordedAuditReceipt(transaction, freshExpected),
    }))).resolves.toBe("original");
    const rows = await owner.query("SELECT actor_user_id, action, company_id, after, occurred_at FROM audit_log WHERE entity_id=$1", [freshExpected.entityId]);
    expect(rows.rows).toEqual([{ actor_user_id: actorId, action: expected.action, company_id: companyId, after: expected.after, occurred_at: changedAt }]);
  });

  test.each([
    { companyId: "00000000-0000-0000-0000-000000000899" },
    { entityId: "00000000-0000-0000-0000-000000000898" },
    { action: "offboarding.removal_unconfirmed" },
    { entityType: "LicenseRequest" },
    { after: { ...expected.after, completionId: "substituted" } },
    { actorUserId: rollbackActorId },
    { occurredAt: new Date("2026-07-26T20:15:00.000Z") },
  ])("rejects mismatched receipt identity %j and rolls back mutation", async mismatch => {
    const database = drizzle(appPool, { schema });
    const before = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    await expect(withAudit(database, async transaction => {
      await transaction.update(userAccount).set({ uiLanguage: "en" }).where(eq(userAccount.id, rollbackActorId));
      return { value: "wrong", audit: await verifyRecordedAuditReceipt(transaction, { ...expected, ...mismatch }) };
    })).rejects.toThrow("RECORDED_AUDIT_NOT_FOUND");
    const after = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    expect(after.rows).toEqual(before.rows);
  });

  test("rejects forged, foreign and expired receipts without committing mutation", async () => {
    const database = drizzle(appPool, { schema });
    let expired: RecordedAuditReceipt | undefined;
    await withAudit(database, async transaction => {
      expired = await verifyRecordedAuditReceipt(transaction, expected);
      return { value: "verified", audit: expired };
    });
    for (const token of [{} as RecordedAuditReceipt, { ...expired! }, expired!]) {
      const before = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
      await expect(withAudit(database, async transaction => {
        await transaction.update(userAccount).set({ uiLanguage: "en" }).where(eq(userAccount.id, rollbackActorId));
        return { value: "wrong", audit: token };
      })).rejects.toThrow("INVALID_RECORDED_AUDIT_RECEIPT");
      const after = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
      expect(after.rows).toEqual(before.rows);
    }
    await expect(database.transaction(transaction => verifyRecordedAuditReceipt(transaction, expected))).rejects.toThrow("INACTIVE_AUDIT_TRANSACTION");
  });

  test("rejects a token owned by another still-active outer transaction", async () => {
    const database = drizzle(appPool, { schema });
    const before = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    await withAudit(database, async outer => {
      const receipt = await verifyRecordedAuditReceipt(outer, expected);
      await expect(withAudit(database, async inner => {
        await inner.update(userAccount).set({ uiLanguage: "en" }).where(eq(userAccount.id, rollbackActorId));
        return { value: "wrong", audit: receipt };
      })).rejects.toThrow("INVALID_RECORDED_AUDIT_RECEIPT");
      return { value: "original", audit: receipt };
    });
    const after = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    expect(after.rows).toEqual(before.rows);
  });

  test.each(["actorUserId", "action", "entityType", "entityId", "companyId", "note", "before", "after"])("rejects a partially forged descriptor missing %s", async field => {
    const database = drizzle(appPool, { schema });
    const forged: Record<string, unknown> = { ...expected, note: null, before: null };
    delete forged[field];
    const before = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    const countBefore = await owner.query("SELECT count(*)::int AS count FROM audit_log");
    await expect(withAudit(database, async transaction => {
      await transaction.update(userAccount).set({ uiLanguage: "en" }).where(eq(userAccount.id, rollbackActorId));
      return { value: "wrong", audit: forged as unknown as RecordedAuditReceipt };
    })).rejects.toThrow("INVALID_RECORDED_AUDIT_RECEIPT");
    const after = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    expect(after.rows).toEqual(before.rows);
    const countAfter = await owner.query("SELECT count(*)::int AS count FROM audit_log");
    expect(countAfter.rows).toEqual(countBefore.rows);
  });

  test.each([null, undefined, "forged"])("rejects non-object forged receipt %j", async forged => {
    const database = drizzle(appPool, { schema });
    await expect(withAudit(database, async () => ({ value: "wrong", audit: forged as unknown as RecordedAuditReceipt }))).rejects.toThrow("INVALID_RECORDED_AUDIT_RECEIPT");
  });

  test("optional actor/time preserve canonical matching", async () => {
    const database = drizzle(appPool, { schema });
    const identity = { action: expected.action, entityType: expected.entityType, entityId: expected.entityId, companyId: expected.companyId, after: expected.after };
    await expect(withAudit(database, async transaction => ({ value: "original", audit: await verifyRecordedAuditReceipt(transaction, identity) }))).resolves.toBe("original");
  });

  test("undefined and circular expected payloads reject and roll back", async () => {
    const database = drizzle(appPool, { schema });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const [payload, reason] of [[undefined, "INVALID_RECORDED_AUDIT_EXPECTATION"], [circular, "circular"]] as const) {
      const before = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
      const countBefore = await owner.query("SELECT count(*)::int AS count FROM audit_log");
      await expect(withAudit(database, async transaction => {
        await transaction.update(userAccount).set({ uiLanguage: "en" }).where(eq(userAccount.id, rollbackActorId));
        return { value: "wrong", audit: await verifyRecordedAuditReceipt(transaction, { ...expected, after: payload }) };
      })).rejects.toThrow(reason);
      const after = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
      expect(after.rows).toEqual(before.rows);
      const countAfter = await owner.query("SELECT count(*)::int AS count FROM audit_log");
      expect(countAfter.rows).toEqual(countBefore.rows);
    }
  });

  test("revokes the exact outer transaction context after commit", async () => {
    const database = drizzle(appPool, { schema });
    let closed: Parameters<typeof verifyRecordedAuditReceipt>[0] | undefined;
    await withAudit(database, async transaction => {
      closed = transaction;
      return { value: "original", audit: await verifyRecordedAuditReceipt(transaction, expected) };
    });
    await expect(verifyRecordedAuditReceipt(closed!, expected)).rejects.toThrow("INACTIVE_AUDIT_TRANSACTION");
  });

  test("missing evidence rolls back a nested mutation and suppresses afterCommit", async () => {
    const database = drizzle(appPool, { schema });
    const observed: string[] = [];
    const before = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    await expect(withAudit(database, async transaction => {
      await transaction.transaction(nested => nested.update(userAccount).set({ uiLanguage: "en" }).where(eq(userAccount.id, rollbackActorId)));
      return { value: "wrong", audit: await verifyRecordedAuditReceipt(transaction, { ...expected, entityId: rollbackActorId }) };
    }, { afterCommit: async value => { observed.push(value); }, onAfterCommitFailure: async error => { throw error; } })).rejects.toThrow("RECORDED_AUDIT_NOT_FOUND");
    const after = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    expect(after.rows).toEqual(before.rows);
    expect(observed).toEqual([]);
  });

  test.each(["deleted", "changed"] as const)("rejects evidence %s after token creation before outer commit", async alteration => {
    // Owner-only fault injection bypasses the real append-only trigger inside the
    // transaction; rollback restores both evidence and trigger. App grants stay intact.
    const database = drizzle(owner, { schema });
    const before = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    await expect(withAudit(database, async transaction => {
      const audit = await verifyRecordedAuditReceipt(transaction, expected);
      await transaction.update(userAccount).set({ uiLanguage: "en" }).where(eq(userAccount.id, rollbackActorId));
      await transaction.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_mutate`);
      if (alteration === "deleted") await transaction.delete(auditLog).where(eq(auditLog.entityId, receiptEntity));
      else await transaction.update(auditLog).set({ after: { completionId: "changed" } }).where(eq(auditLog.entityId, receiptEntity));
      return { value: "wrong", audit };
    })).rejects.toThrow("RECORDED_AUDIT_CHANGED");
    const after = await owner.query("SELECT ui_language FROM user_account WHERE id=$1", [rollbackActorId]);
    expect(after.rows).toEqual(before.rows);
    const rows = await owner.query("SELECT after FROM audit_log WHERE entity_id=$1", [receiptEntity]);
    expect(rows.rows).toEqual([{ after: expected.after }]);
    const trigger = await owner.query("SELECT tgenabled FROM pg_trigger WHERE tgname='audit_log_no_mutate'");
    expect(trigger.rows).toEqual([{ tgenabled: "O" }]);
  });
});
