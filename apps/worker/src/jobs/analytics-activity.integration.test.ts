import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import { encryptCredential } from "@smp/db/credential-crypto";
import { serializeCredentialEnvelope } from "@smp/domain";
import { SYSTEM_USER_ID } from "@smp/db/system-ids";
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { createAnalyticsActivityJob } from "./analytics-activity.js";
import { createDeferredJobHandlers } from "./deferred.js";
let fixture: PostgresFixture, owner: pg.Client, root: string, kekFile: string;
const id = (n: number) => `07000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2026-03-03T00:00:00Z");
beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  root = await mkdtemp(join(tmpdir(), "ledger-activity-"));
  kekFile = join(root, "kek");
  const kek = Buffer.alloc(32, 7);
  await writeFile(kekFile, kek.toString("base64"));
  await chmod(kekFile, 0o400);
  await owner.query(`INSERT INTO company(id,name,code,type,status,statement_language,created_at,created_by) VALUES($1,'A','ACTA','internal','active','en',$3,$4),($2,'B','ACTB','internal','active','en',$3,$4)`, [id(1), id(2), at, SYSTEM_USER_ID]);
  await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,'a@example.test','A',$3,'active',$5,$6),($2,'b@example.test','B',$4,'active',$5,$6)`, [id(3), id(4), id(1), id(2), at, SYSTEM_USER_ID]);
  await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,'Anthropic','api','rest',true,true,true,true,'email','active',$2,$3)`, [id(5), at, SYSTEM_USER_ID]);
  for (const [n, source, mode] of [
    [6, 'api', 'orchestration'], [7, 'manual', 'automated'], [8, 'csv_import', 'automated']
  ])
    await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,ingestion_mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,$3,$4,$5,0,'active',$6,$7)`, [id(Number(n)), id(5), source, mode, source, at, SYSTEM_USER_ID]);
  await owner.query(`INSERT INTO integration_credential(vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by) VALUES($1,'analytics',$2,'ok','active',$3,$4),($1,'admin_scoped',$5,'ok','active',$3,$4)`, [
    id(6), serializeCredentialEnvelope(await encryptCredential('analytics-secret', kek)), at, SYSTEM_USER_ID, serializeCredentialEnvelope(await encryptCredential('admin-secret', kek))
  ]);
}, 120000);
afterAll(async () => { await owner?.end(); await fixture?.stop(); if (root)
  await rm(root, { recursive: true, force: true }); });
// AC1/2/4 faults: missing deferred wiring, arbitrary tenant, page counters conflated, dropped warnings, pool leaks.
test("routes all provider identities once and refreshes stable rows through deferred execution", async () => {
  let now = new Date("2026-03-03T10:00:00Z");
  const dates: string[] = [];
  const handlers = createDeferredJobHandlers(undefined, {
    connectionString: fixture.appUrl, credentialKekAllowedRoot: root, credentialKekFile: kekFile, now: () => now, sleep: async () => {}, workerId: 'activity-test', transport: async (request) => {
      const url = new URL(request.url);
      dates.push(url.searchParams.get('date')!);
      return new Response(JSON.stringify({
        data: [
          {
            user: { type: 'user', id: 'u-a', email_address: 'A@example.test' }, chat_metrics: { message_count: 2 }
          }, {
            user: { type: 'user', id: 'u-b', email_address: 'b@example.test' }, chat_metrics: { message_count: 9 }
          }, {
            user: { type: 'user', id: 'u-x', email_address: 'unknown@example.test' }, chat_metrics: null
          }, { user: null, chat_metrics: { message_count: 3 } }
        ], next_page: null
      }), { headers: { 'content-type': 'application/json' } });
    }
  });
  const context = {
    at, jobName: 'analyticsSync' as const, jobId: 'activity', idempotencyKey: 'activity', vendorAccountId: id(6)
  };
  expect(await handlers.analyticsSync(context)).toEqual({ status: 'succeeded', processed: 2 });
  expect(dates).toEqual(['2026-02-28']);
  const first = (await owner.query(`SELECT id,person_id,counters,synced_at,activity_date::text FROM activity_record ORDER BY person_id`)).rows;
  expect(first.map(r => ({ person: r.person_id, counters: r.counters, day: r.activity_date }))).toEqual([
    { person: id(3), counters: { chat_metrics: { message_count: 2 } }, day: '2026-02-28' }, { person: id(4), counters: { chat_metrics: { message_count: 9 } }, day: '2026-02-28' }
  ]);
  const warnings = (await owner.query(`SELECT company_id,entity_type,entity_id,actor_user_id,after FROM audit_log WHERE action='analytics_identity_warning' ORDER BY after->>'reason'`)).rows;
  expect(warnings).toHaveLength(2);
  expect(warnings.map(row => ({
    entityType: row.entity_type, entityId: row.entity_id, actorUserId: row.actor_user_id
  }))).toEqual(Array(2).fill({ entityType: 'VendorAccount', entityId: id(6), actorUserId: SYSTEM_USER_ID }));
  expect(warnings.map(r => r.company_id)).toEqual([null, null]);
  expect(warnings.map(r => r.after)).toEqual([
    {
      vendorAccountId: id(6), activityDate: '2026-02-28', reason: 'missing_email', identity: { email: null, providerUserId: null }
    }, {
      vendorAccountId: id(6), activityDate: '2026-02-28', reason: 'unmatched_email', identity: { email: 'unknown@example.test', providerUserId: 'u-x' }
    }
  ]);
  const observations = (await owner.query(`SELECT operation,provisioning_action_id,summary FROM connector_call_observation`)).rows;
  expect(observations.length).toBeGreaterThan(0);
  expect(observations.every(r => r.operation === 'sync_activity' && r.provisioning_action_id === null)).toBe(true);
  expect(JSON.stringify(observations)).not.toContain('analytics-secret');
  now = new Date('2026-03-03T11:00:00Z');
  expect(await handlers.analyticsSync({ ...context, vendorAccountId: undefined })).toEqual({ status: 'succeeded', processed: 2 });
  const next = (await owner.query(`SELECT id,synced_at FROM activity_record ORDER BY person_id`)).rows;
  expect(next.map(r => r.id)).toEqual(first.map(r => r.id));
  expect(next.every(r => r.synced_at.getTime() === now.getTime())).toBe(true);
  expect((await owner.query(`SELECT count(*)::int AS count FROM audit_log WHERE action='analytics_identity_warning'`)).rows).toEqual([{ count: 4 }]);
  expect((await owner.query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND usename='ledger_app'`, [fixture.databaseName])).rows).toEqual([{ count: 0 }]);
});
// AC3 fault: provisioning mode used for exclusion, credential reads before ingestion-mode gate.
test("excludes targeted manual and CSV ingestion without credentials or transport", async () => {
  const before = (await owner.query(`SELECT count(*)::int AS count FROM connector_call_observation`)).rows;
  const handlers = createDeferredJobHandlers(undefined, {
    connectionString: fixture.appUrl, now: () => at, sleep: async () => {}, workerId: 'excluded', transport: async () => { throw Error('excluded provider call'); }
  });
  for (const n of [7, 8])
    expect(await handlers.analyticsSync({
      at, jobName: 'analyticsSync', jobId: 'excluded', idempotencyKey: 'excluded', vendorAccountId: id(n)
    })).toEqual({ status: 'succeeded', processed: 0 });
  expect((await owner.query(`SELECT count(*)::int AS count FROM connector_call_observation`)).rows).toEqual(before);
});
function options(transport: (request: Request) => Promise<Response>, now = () => new Date('2026-03-10T10:00:00Z')) {
  return {
    connectionString: fixture.appUrl, allowedKekRoot: root, kekFile, now, sleep: async () => {}, transport
  };
}
function response(data: unknown[], next_page: string | null = null) { return new Response(JSON.stringify({ data, next_page }), { headers: { 'content-type': 'application/json' } }); }
function user(email: string, count: number) { return {
  user: { type: 'user', id: `u-${email}`, email_address: email }, chat_metrics: { message_count: count }
}; }
// AC1 date fault: local elapsed-time subtraction vs UTC calendar date; drain closing reusable resources.
test('uses UTC calendar subtraction across leap, year and timezone boundaries on reusable resources', async () => {
  const dates: string[] = [];
  const job = createAnalyticsActivityJob(options(async (request) => { dates.push(new URL(request.url).searchParams.get('date')!); return response([]); }));
  try {
    for (const date of [
      '2024-03-03T00:00:00Z', '2026-01-02T23:59:59Z', '2026-03-01T00:15:00+14:00', '2026-03-03T23:59:59-05:00'
    ])
      expect(await job.drain({ at: new Date(date), vendorAccountId: id(6) })).toEqual({ processed: 0 });
    expect(dates).toEqual(['2024-02-29', '2025-12-30', '2026-02-25', '2026-03-01']);
  } finally {
    await job.close();
  }
});
// AC1/4 faults: persist page one before page two finishes; disabled inflight warning retention.
test('fetches all pages before writes and excludes a snapshot disabled during its fetch', async () => {
  const day = '2026-03-07';
  let pages = 0;
  const job = createAnalyticsActivityJob(options(async (request) => {
    pages++;
    const url = new URL(request.url);
    expect((await owner.query(`SELECT count(*)::int AS count FROM activity_record WHERE activity_date=$1`, [day])).rows).toEqual([{ count: 0 }]);
    if (pages === 1) {
      expect(url.searchParams.has('page')).toBe(false);
      return response([user('a@example.test', 10)], 'page-two');
    }
    expect(url.searchParams.get('page')).toBe('page-two');
    await owner.query(`UPDATE vendor_account SET ingestion_mode='manual' WHERE id=$1`, [id(6)]);
    return response([user('b@example.test', 20), user('unmatched@example.test', 30)]);
  }));
  const before = (await owner.query(`SELECT count(*)::int AS count FROM audit_log WHERE action IN ('analytics_identity_warning','analytics_activity_sync')`)).rows;
  try {
    expect(await job.drain({ at: new Date('2026-03-10T00:00:00Z'), vendorAccountId: id(6) })).toEqual({ processed: 0 });
    expect(pages).toBe(2);
    expect((await owner.query(`SELECT count(*)::int AS count FROM activity_record WHERE activity_date=$1`, [day])).rows).toEqual([{ count: 0 }]);
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_log WHERE action IN ('analytics_identity_warning','analytics_activity_sync')`)).rows).toEqual(before);
    await expectNoOpenJobTransaction();
  } finally {
    await owner.query(`UPDATE vendor_account SET ingestion_mode='api' WHERE id=$1`, [id(6)]);
    await job.close();
  }
});
// AC2 replay faults: finishing time used as freshness, missing unique key, stale overwrite or equal contradiction.
test('concurrent reruns retain one natural key and a slow stale attempt cannot replace newer counters', async () => {
  let release!: () => void;
  let reached!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const old = createAnalyticsActivityJob(options(async () => { reached(); await gate; return response([user('a@example.test', 1)]); }, () => new Date('2026-03-11T10:00:00Z')));
  const newer = createAnalyticsActivityJob(options(async () => response([user('a@example.test', 99)]), () => new Date('2026-03-11T11:00:00Z')));
  const input = { at: new Date('2026-03-11T00:00:00Z'), vendorAccountId: id(6) };
  let slow: Promise<{
    processed: number;
  }> | undefined;
  try {
    slow = old.drain(input);
    await waiting;
    const results = await Promise.all([newer.drain(input), newer.drain(input)]);
    expect(results.map(r => r.processed).sort()).toEqual([0, 1]);
    release();
    expect(await slow).toEqual({ processed: 0 });
    const rows = (await owner.query(`SELECT person_id,counters,synced_at FROM activity_record WHERE vendor_account_id=$1 AND activity_date='2026-03-08'`, [id(6)])).rows;
    expect(rows).toEqual([
      {
        person_id: id(3), counters: { chat_metrics: { message_count: 99 } }, synced_at: new Date('2026-03-11T11:00:00Z')
      }
    ]);
  } finally {
    release();
    await slow?.catch(() => {});
    await Promise.all([old.close(), newer.close()]);
  }
  const contradiction = createAnalyticsActivityJob(options(async () => response([user('a@example.test', 98)]), () => new Date('2026-03-11T11:00:00Z')));
  try {
    await expect(contradiction.drain(input)).rejects.toThrow('ACTIVITY_REPLAY_CONFLICT');
  } finally {
    await contradiction.close();
  }
});
// AC4 failure fault: swallowed provider/driver error and leaked handler-owned resources.
test('propagates provider, eligibility and database failures and closes handler resources', async () => {
  const context = {
    at: new Date('2026-03-12T00:00:00Z'), jobName: 'analyticsSync' as const, jobId: 'failure', idempotencyKey: 'failure', vendorAccountId: id(6)
  };
  const handler = (transport: (request: Request) => Promise<Response>) => createDeferredJobHandlers(undefined, {
    ...options(transport), credentialKekFile: kekFile, credentialKekAllowedRoot: root, workerId: 'failure'
  }).analyticsSync;
  await expect(handler(async () => new Response('{}', { status: 400 }))(context)).rejects.toMatchObject({
    message: 'ACTIVITY_PROVIDER_ERROR', code: 'SYNC_STALE', vendorAccountId: id(6), retryable: false
  });
  await owner.query(`UPDATE vendor SET identity_matching='vendor_user_id' WHERE id=$1`, [id(5)]);
  try {
    await expect(handler(async () => { throw Error('unsupported remote call'); })(context)).rejects.toThrow('ACTIVITY_ACCOUNT_UNSUPPORTED');
  } finally {
    await owner.query(`UPDATE vendor SET identity_matching='email' WHERE id=$1`, [id(5)]);
  }
  await owner.query(`REVOKE INSERT ON audit_log FROM ledger_app`);
  try {
    await expect(handler(async () => response([user('a@example.test', 2), user('unknown@example.test', 2)]))(context)).rejects.toThrow();
  } finally {
    await owner.query(`GRANT INSERT ON audit_log TO ledger_app`);
  }
  expect((await owner.query(`SELECT count(*)::int AS count FROM audit_log WHERE action='analytics_identity_warning' AND after->>'activityDate'='2026-03-09'`)).rows).toEqual([{ count: 0 }]);
  expect((await owner.query(`SELECT count(*)::int AS count FROM activity_record WHERE activity_date='2026-03-09'`)).rows).toEqual([{ count: 0 }]);
  expect((await owner.query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND usename='ledger_app'`, [fixture.databaseName])).rows).toEqual([{ count: 0 }]);
});
async function expectNoOpenJobTransaction() {
  const inspector = await fixture.connectAsApp();
  try {
    expect((await inspector.query(`SELECT count(*)::int AS count FROM pg_stat_activity
   WHERE datname=current_database() AND usename=current_user AND pid<>pg_backend_pid()
     AND (state LIKE 'idle in transaction%' OR xact_start IS NOT NULL)`)).rows).toEqual([{ count: 0 }]);
  } finally {
    await inspector.end();
  }
}
// I1: nested root Drizzle transaction commits/relinquishes the account lock after first company.
test('holds account opt-in after the first company batch until the whole attempt commits', async () => {
  const job = createAnalyticsActivityJob(options(async () => response([user('a@example.test', 10), user('unmatched-gate@example.test', 20)])));
  const updater = await fixture.connectAsOwner();
  let run: Promise<{
    processed: number;
  }> | undefined;
  await owner.query(`CREATE FUNCTION activity_second_company_gate() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.action='analytics_identity_warning' AND NEW.after->>'activityDate'='2026-03-10' THEN
 PERFORM pg_advisory_xact_lock(70070); END IF; RETURN NEW; END $$`);
  await owner.query(`CREATE TRIGGER activity_second_company_gate BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION activity_second_company_gate()`);
  await owner.query('SELECT pg_advisory_lock(70070)');
  try {
    run = job.drain({ at: new Date('2026-03-13T00:00:00Z'), vendorAccountId: id(6) });
    let blocked = false;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const result = await updater.query<{
        blocked: boolean;
      }>(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=70070 AND NOT granted) AS blocked`);
      if (result.rows[0].blocked) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
    await updater.query("SET lock_timeout='250ms'");
    await expect(updater.query(`UPDATE vendor_account SET ingestion_mode='manual' WHERE id=$1`, [id(6)])).rejects.toMatchObject({ code: '55P03' });
    await expect(updater.query(`UPDATE vendor SET has_usage_data=false WHERE id=$1`, [id(5)])).rejects.toMatchObject({ code: '55P03' });
    await owner.query('SELECT pg_advisory_unlock(70070)');
    expect(await run).toEqual({ processed: 1 });
    await expectNoOpenJobTransaction();
  } finally {
    await owner.query('SELECT pg_advisory_unlock(70070)');
    await run?.catch(() => {});
    await owner.query(`DROP TRIGGER activity_second_company_gate ON audit_log; DROP FUNCTION activity_second_company_gate()`);
    await updater.end();
    await owner.query(`UPDATE vendor_account SET ingestion_mode='api' WHERE id=$1`, [id(6)]);
    await job.close();
  }
});
// I1: late global audit failure leaves successfully committed company rows and open transaction.
test('rolls back earlier company batches on later global warning failure before closing resources', async () => {
  const job = createAnalyticsActivityJob(options(async () => response([
    user('a@example.test', 10), user('b@example.test', 20), user('late-warning@example.test', 3)
  ])));
  await owner.query(`CREATE FUNCTION activity_late_warning_failure() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.action='analytics_identity_warning' AND NEW.after->>'activityDate'='2026-03-11' THEN
 RAISE EXCEPTION 'activity late warning fault'; END IF; RETURN NEW; END $$`);
  await owner.query(`CREATE TRIGGER activity_late_warning_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION activity_late_warning_failure()`);
  try {
    await expect(job.drain({ at: new Date('2026-03-14T00:00:00Z'), vendorAccountId: id(6) })).rejects.toThrow('activity late warning fault');
    expect((await owner.query(`SELECT count(*)::int AS count FROM activity_record WHERE activity_date='2026-03-11'`)).rows).toEqual([{ count: 0 }]);
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_log WHERE after->>'activityDate'='2026-03-11'`)).rows).toEqual([{ count: 0 }]);
    await expectNoOpenJobTransaction();
  } finally {
    await owner.query(`DROP TRIGGER activity_late_warning_failure ON audit_log; DROP FUNCTION activity_late_warning_failure()`);
    await job.close();
  }
});
// I2: rejected API input must never reach credential/provider work.
test('rejects invalid scheduled time and UUID prefix or suffix before credentials or transport', async () => {
  const job = createAnalyticsActivityJob({
    connectionString: fixture.appUrl, now: () => at, sleep: async () => {}, transport: async () => { throw Error('invalid-input transport'); }
  });
  try {
    await expect(job.drain({ at: new Date(NaN), vendorAccountId: id(6) })).rejects.toThrow('ACTIVITY_TIME_INVALID');
    for (const vendorAccountId of ['invalid', `prefix${id(6)}`, `${id(6)}suffix`])
      await expect(job.drain({ at, vendorAccountId })).rejects.toThrow('ACTIVITY_VENDOR_INVALID');
    await expectNoOpenJobTransaction();
  } finally {
    await job.close();
  }
});
// I2: unsupported global API accounts must exit with the processed contract before missing KEK.
test('skips unsupported global protocol and rejects targeted protocol before credentials', async () => {
  const job = createAnalyticsActivityJob({
    connectionString: fixture.appUrl, now: () => at, sleep: async () => {}, transport: async () => { throw Error('unsupported transport'); }
  });
  await owner.query(`UPDATE vendor SET provisioning_protocol='scim' WHERE id=$1`, [id(5)]);
  try {
    expect(await job.drain({ at })).toEqual({ processed: 0 });
    await expect(job.drain({ at, vendorAccountId: id(6) })).rejects.toThrow('ACTIVITY_ACCOUNT_UNSUPPORTED');
    await expectNoOpenJobTransaction();
  } finally {
    await owner.query(`UPDATE vendor SET provisioning_protocol='rest' WHERE id=$1`, [id(5)]);
    await job.close();
  }
});
// I2: dropping the injected limiter clock permits the sixty-first request before budget refresh.
// The nested nullable data/opaque-page/analytics GET transport contract is backed
// by connector.pact.test.ts "documented per-person activity"; no external 429 double.
test('uses injected time to throttle analytics pagination and records the refreshed attempt instant', async () => {
  let milliseconds = Date.parse('2026-03-15T10:00:00Z');
  const waits: number[] = [];
  const requestInstants: number[] = [];
  let pages = 0;
  const job = createAnalyticsActivityJob({
    ...options(async (request) => {
      const url = new URL(request.url);
      expect(request.method).toBe('GET');
      expect(url.pathname).toBe('/v1/organizations/analytics/users');
      expect(request.headers.get('x-api-key')).toBe('analytics-secret');
      requestInstants.push(milliseconds);
      pages++;
      return response([], pages === 61 ? null : `page-${pages}`);
    }, () => new Date(milliseconds)), sleep: async (duration) => { waits.push(duration); milliseconds += duration; }
  });
  try {
    expect(await job.drain({ at: new Date('2026-03-15T00:00:00Z'), vendorAccountId: id(6) })).toEqual({ processed: 0 });
    expect(pages).toBe(61);
    expect(waits).toEqual([60000]);
    expect(requestInstants.slice(0, 60)).toEqual(Array(60).fill(Date.parse('2026-03-15T10:00:00Z')));
    expect(requestInstants[60]).toBe(Date.parse('2026-03-15T10:01:00Z'));
    expect((await owner.query(`SELECT occurred_at FROM connector_call_observation WHERE vendor_account_id=$1 AND phase='succeeded' ORDER BY occurred_at DESC LIMIT 1`, [id(6)])).rows).toEqual([{ occurred_at: new Date('2026-03-15T10:01:00Z') }]);
    await expectNoOpenJobTransaction();
  } finally {
    await job.close();
  }
});
