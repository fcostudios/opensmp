import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LedgerAuthorization } from "./identity-access/authorization";

import {
  countAuthorizedAlertEvents,
  formatOperationalBadgeCount,
  listAuthorizedAlertEvents,
  parseAlertCursor,
  serializeAlertCursor,
} from "./operational-alert-read";

const ids = {
  companyA: "42000000-0000-4000-8000-000000000001",
  companyB: "42000000-0000-4000-8000-000000000002",
  ruleA: "42000000-0000-4000-8000-000000000003",
  ruleB: "42000000-0000-4000-8000-000000000004",
  globalRule: "42000000-0000-4000-8000-000000000005",
} as const;

let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;

function authorization(
  companyIds: readonly string[],
  globalRole: LedgerAuthorization["globalRole"] = null,
): LedgerAuthorization {
  return {
    companyGrants: companyIds.map((companyId) => ({
      companyId,
      role: "viewer" as const,
    })),
    companyIds,
    employeeCompanyId: null,
    globalRole,
    idpSubject: "alert-read-mutation",
    roles: globalRole === "group_admin" ? ["group_admin"] : ["viewer"],
    userAccountId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000001",
  };
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(
    `TRUNCATE TABLE alert_notification_delivery, alert_event, alert_rule,
      company RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ('00000000-0000-0000-0000-000000000001','system@ledger.test',
        'system','group_admin','es','active',now())
     ON CONFLICT (id) DO NOTHING`,
  );
  await owner.query(
    `INSERT INTO company (id,name,code,type,status,created_at,created_by)
     VALUES
       ($1,'Company A','A-MUT','internal','active',now(),
        '00000000-0000-0000-0000-000000000001'),
       ($2,'Company B','B-MUT','external','active',now(),
        '00000000-0000-0000-0000-000000000001')`,
    [ids.companyA, ids.companyB],
  );
  await owner.query(
    `INSERT INTO alert_rule
       (id,type,scope_kind,company_id,threshold,channel,enabled,created_at,created_by)
     VALUES
       ($3,'low_pool','company',$1,'{"floor":2}','email',true,now(),
        '00000000-0000-0000-0000-000000000001'),
       ($4,'low_pool','company',$2,'{"floor":2}','email',true,now(),
        '00000000-0000-0000-0000-000000000001'),
       ($5,'low_pool','global',NULL,'{"floor":5}','email',true,now(),
        '00000000-0000-0000-0000-000000000001')`,
    [ids.companyA, ids.companyB, ids.ruleA, ids.ruleB, ids.globalRule],
  );
  for (let index = 0; index < 5; index += 1) {
    await owner.query(
      `INSERT INTO alert_event
          (alert_rule_id,fired_at,subject_ref,notified,dedupe_key)
       VALUES
         ($1,'2026-07-29T14:00:00.000Z',
          jsonb_build_object('vendorAccountId',$2::text),
          '{"status":"pending"}',$3)`,
      [ids.ruleA, `account-${index}`, `a-${index}`],
    );
  }
  await owner.query(
    `INSERT INTO alert_event
       (alert_rule_id,fired_at,subject_ref,notified,dedupe_key,acknowledged_at)
     VALUES
       ($1,'2026-07-29T13:00:00.000Z','{"vendorAccountId":"b"}',
        '{"status":"pending"}','b-1',NULL),
       ($2,'2026-07-29T12:00:00.000Z','{"vendorAccountId":"global"}',
        '{"status":"pending"}','global-1',NULL),
       ($3,'2026-07-29T11:00:00.000Z','{"vendorAccountId":"a-ack"}',
        '{"status":"pending"}','a-ack','2026-07-29T12:00:00.000Z')`,
    [ids.ruleB, ids.globalRule, ids.ruleA],
  );
}, 120_000);

afterAll(async () => {
  await pool.end();
  await owner.end();
  await fixture.stop();
});

describe("US-042 bounded alert read mutation contract", () => {
  it("counts the complete authorized stream independently of page limits", async () => {
    for (let index = 0; index < 55; index += 1) {
      await owner.query(
        `INSERT INTO alert_event
           (alert_rule_id,fired_at,subject_ref,notified,dedupe_key)
         VALUES
           ($1,$2,jsonb_build_object('vendorAccountId',$3::text),
            '{"status":"pending"}',$4)`,
        [
          ids.ruleA,
          new Date(2026, 6, 28, 12, 0, index),
          `later-${index}`,
          `later-${index}`,
        ],
      );
    }
    await expect(
      countAuthorizedAlertEvents(pool, authorization([ids.companyA])),
    ).resolves.toEqual({ all: BigInt(61), unacknowledged: BigInt(60) });
    await expect(
      countAuthorizedAlertEvents(pool, authorization([ids.companyB])),
    ).resolves.toEqual({ all: BigInt(1), unacknowledged: BigInt(1) });
    await expect(
      countAuthorizedAlertEvents(
        pool,
        authorization([ids.companyA, ids.companyB], "group_admin"),
      ),
    ).resolves.toEqual({ all: BigInt(63), unacknowledged: BigInt(62) });
    expect(formatOperationalBadgeCount(BigInt(99))).toBe("99");
    expect(formatOperationalBadgeCount(BigInt(100))).toBe("99+");
    expect(
      formatOperationalBadgeCount(
        BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
      ),
    )
      .toBe("99+");
  });

  it("rejects malformed cursors and round-trips the deterministic tuple", () => {
    const event = {
      firedAt: new Date("2026-07-29T14:00:00.000Z"),
      id: "42000000-0000-4000-8000-000000000042",
    };
    expect(parseAlertCursor(null)).toBeNull();
    expect(parseAlertCursor("invalid")).toBeNull();
    expect(parseAlertCursor(`not-a-date|${event.id}`)).toBeNull();
    expect(parseAlertCursor("2026-07-29T14:00:00.000Z|invalid")).toBeNull();
    expect(parseAlertCursor(serializeAlertCursor(event))).toEqual(event);
  });

  it("derives company/global visibility and active filtering from authorization", async () => {
    const company = await listAuthorizedAlertEvents(
      pool,
      authorization([ids.companyA, ids.companyA]),
      { filter: "all", limit: 100 },
    );
    expect(new Set(company.items.map(({ companyId }) => companyId))).toEqual(
      new Set([ids.companyA]),
    );
    expect(company.items.some(({ scopeKind }) => scopeKind === "global")).toBe(
      false,
    );
    const active = await listAuthorizedAlertEvents(
      pool,
      authorization([ids.companyA]),
      { filter: "unacknowledged", limit: 100 },
    );
    expect(active.items.every(({ acknowledgedAt }) => acknowledgedAt === null))
      .toBe(true);
    const admin = await listAuthorizedAlertEvents(
      pool,
      authorization([ids.companyA, ids.companyB], "group_admin"),
      { filter: "all", limit: 100 },
    );
    expect(admin.items.some(({ scopeKind }) => scopeKind === "global")).toBe(
      true,
    );
    expect(admin.items.some(({ companyId }) => companyId === ids.companyB)).toBe(
      true,
    );
  });

  it("pages equal timestamps exactly once with bounded limits", async () => {
    const auth = authorization([ids.companyA]);
    const first = await listAuthorizedAlertEvents(pool, auth, {
      filter: "all",
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listAuthorizedAlertEvents(pool, auth, {
      cursor: first.nextCursor,
      filter: "all",
      limit: 2,
    });
    expect(second.items).toHaveLength(2);
    expect(
      first.items.some(({ id }) => second.items.some((item) => item.id === id)),
    ).toBe(false);
    const clamped = await listAuthorizedAlertEvents(pool, auth, {
      filter: "all",
      limit: 0,
    });
    expect(clamped.items).toHaveLength(1);
    expect(clamped.nextCursor).not.toBeNull();
  });
});
