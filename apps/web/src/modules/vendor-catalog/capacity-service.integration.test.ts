import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@smp/db/schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { enqueueCapacityRecovery } from "./capacity-recovery-outbox";
import { createCapacityService } from "./capacity-service";

const id = (suffix: string) =>
  `23000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"),
  companyA: id("2"),
  companyB: id("3"),
  vendorA: id("4"),
  vendorB: id("5"),
  accountA: id("6"),
  licenseA: id("7"),
  licenseB: id("8"),
  requester: id("9"),
  personA: id("10"),
  personB: id("11"),
  requestPool: id("12"),
  requestProvider: id("13"),
  requestOtherTenant: id("14"),
  blockedRule: id("15"),
};
const now = new Date("2026-08-04T15:00:00.000Z");
const authorization: LedgerAuthorization = {
  companyGrants: [],
  companyIds: [ids.companyA, ids.companyB],
  employeeCompanyId: null,
  globalRole: "group_admin",
  idpSubject: "capacity-admin",
  roles: ["group_admin"],
  userAccountId: ids.admin,
  userId: ids.admin,
};

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  await owner.query(
    `TRUNCATE TABLE audit_log, request_transition, provisioning_action,
       license_request, capacity_recovery_work, vendor_account_capacity, license_assignment, license_type,
       vendor_account, vendor, person, company, user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ('00000000-0000-0000-0000-000000000001','system@ledger.invalid',
             'ledger-system',NULL,'en','active',$3),
            ($1,'admin@capacity.test','capacity-admin','group_admin','es','active',$3),
            ($2,'requester@capacity.test','capacity-requester',NULL,'en','active',$3)`,
    [ids.admin, ids.requester, now],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES ($1,'A','CAPA','internal','active','es',$3,$4),
            ($2,'B','CAPB','external','active','es',$3,$4)`,
    [ids.companyA, ids.companyB, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ($1,'a@capacity.test','Person A',$3,'active',$5,$6),
            ($2,'b@capacity.test','Person B',$4,'active',$5,$6)`,
    [ids.personA, ids.personB, ids.companyA, ids.companyB, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Vendor A','api','rest',true,true,false,false,'email','active',$3,$4),
            ($2,'Vendor B','api','rest',true,true,false,false,'email','active',$3,$4)`,
    [ids.vendorA, ids.vendorB, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Account A','automated',1,'active',$3,$4)`,
    [ids.accountA, ids.vendorA, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$3,'A seat','seat','active',$4,$5),
            ($2,$6,'B seat','seat','active',$4,$5)`,
    [ids.licenseA, ids.licenseB, ids.vendorA, now, ids.admin, ids.vendorB],
  );
  await owner.query(
    `INSERT INTO alert_rule
       (id,type,scope_kind,threshold,channel,enabled,created_at,created_by)
     VALUES ($1,'blocked_no_seat','global','{"businessDays":1}','email',true,$2,$3)`,
    [ids.blockedRule, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,
        state,justification,requested_by,created_at,created_by)
     VALUES ($1,'CAP-POOL',$4,$6,$8,$9,'approved','pool',$10,$11,$12),
            ($2,'CAP-PROVIDER',$4,$6,$8,$9,'approved','provider',$10,$11,$12),
            ($3,'CAP-OTHER',$5,$7,$8,$9,'approved','other',$10,$11,$12)`,
    [
      ids.requestPool,
      ids.requestProvider,
      ids.requestOtherTenant,
      ids.personA,
      ids.personB,
      ids.companyA,
      ids.companyB,
      ids.accountA,
      ids.licenseA,
      ids.requester,
      now,
      ids.admin,
    ],
  );
  appPool = new pg.Pool({ connectionString: fixture.appUrl });
  database = drizzle(appPool, { schema });
}, 120_000);

afterAll(async () => {
  await Promise.all([appPool?.end(), owner?.end()]);
  await fixture?.stop();
});

describe("US-023 canonical capacity transaction", () => {
  it("kills bypassing effective-date, vendor/license ownership, and negative-total checks", async () => {
    const service = createCapacityService(database, { now: () => now });

    const result = await service.changeCapacity(authorization, {
      effectiveFrom: "2026-08-04",
      licenseTypeId: ids.licenseA,
      purchasedQty: 3,
      reason: "purchase",
      vendorAccountId: ids.accountA,
    });
    expect(result).toMatchObject({ effectiveFrom: "2026-08-04", purchasedQty: 3 });
    const published = await owner.query(
      `SELECT source,status,effective_from::text,available_at
       FROM capacity_recovery_work WHERE capacity_id=$1`,
      [result.id],
    );
    expect(published.rows).toEqual([
      {
        available_at: now,
        effective_from: "2026-08-04",
        source: "capacity_change",
        status: "pending",
      },
    ]);
    await expect(
      service.changeCapacity(authorization, {
        effectiveFrom: "2026-08-05",
        licenseTypeId: ids.licenseB,
        purchasedQty: 3,
        reason: "purchase",
        vendorAccountId: ids.accountA,
      }),
    ).rejects.toThrow("CAPACITY_LICENSE_VENDOR_MISMATCH");
    await expect(
      service.changeCapacity(authorization, {
        effectiveFrom: "2026-08-05",
        licenseTypeId: ids.licenseA,
        purchasedQty: -1,
        reason: "correction",
        vendorAccountId: ids.accountA,
      }),
    ).rejects.toThrow("CAPACITY_INPUT_INVALID");
    const rows = await owner.query(
      `SELECT vendor_account_id,license_type_id,purchased_qty,effective_from::text
       FROM vendor_account_capacity ORDER BY effective_from`,
    );
    expect(rows.rows).toEqual([
      {
        effective_from: "2026-08-04",
        license_type_id: ids.licenseA,
        purchased_qty: 3,
        vendor_account_id: ids.accountA,
      },
    ]);
  });

  it("kills publishing recovery before a failed capacity transaction commits", async () => {
    const service = createCapacityService(database, { now: () => now });
    const before = await owner.query(
      "SELECT count(*)::int AS count FROM capacity_recovery_work",
    );
    await expect(
      service.changeCapacity(authorization, {
        effectiveFrom: "2026-08-04",
        licenseTypeId: ids.licenseA,
        purchasedQty: 9,
        reason: "correction",
        vendorAccountId: ids.accountA,
      }),
    ).rejects.toThrow("CAPACITY_EFFECTIVE_DATE_CONFLICT");
    const after = await owner.query(
      "SELECT count(*)::int AS count FROM capacity_recovery_work",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("kills making future capacity recovery visible before its Ecuador effective date", async () => {
    const service = createCapacityService(database, { now: () => now });
    const result = await service.changeCapacity(authorization, {
      effectiveFrom: "2026-08-09",
      licenseTypeId: ids.licenseA,
      purchasedQty: 5,
      reason: "purchase",
      vendorAccountId: ids.accountA,
    });
    const work = await owner.query(
      `SELECT available_at FROM capacity_recovery_work WHERE capacity_id=$1`,
      [result.id],
    );
    expect(work.rows[0]?.available_at).toEqual(
      new Date("2026-08-09T05:00:00.000Z"),
    );
  });

  it("deduplicates one release event without swallowing a distinct same-day freed seat", async () => {
    await database.transaction(async (transaction) => {
      for (const releaseEventId of [id("101"), id("102"), id("101")]) {
        await enqueueCapacityRecovery(transaction, {
          capacityId: null,
          effectiveFrom: "2026-08-04",
          licenseTypeId: ids.licenseA,
          occurredAt: now,
          releaseEventId,
          source: "seat_freed",
          vendorAccountId: ids.accountA,
        });
      }
    });
    await expect(
      owner.query(
        `SELECT source,capacity_id,release_event_id::text,status
         FROM capacity_recovery_work WHERE source='seat_freed'
         ORDER BY release_event_id`,
      ),
    ).resolves.toMatchObject({
      rowCount: 2,
      rows: [id("101"), id("102")].map((releaseEventId) => ({
        capacity_id: null,
        release_event_id: releaseEventId,
        source: "seat_freed",
        status: "pending",
      })),
    });
  });

  it("kills accepting a non-admin or any client companyId on the global capacity command", async () => {
    const service = createCapacityService(database, { now: () => now });
    await expect(
      service.changeCapacity({ ...authorization, globalRole: null, roles: ["viewer"] }, {
        effectiveFrom: "2026-08-06",
        licenseTypeId: ids.licenseA,
        purchasedQty: 4,
        reason: "purchase",
        vendorAccountId: ids.accountA,
      }),
    ).rejects.toThrow("CAPACITY_ACCESS_FORBIDDEN");
    await expect(
      service.changeCapacity(authorization, {
        companyId: ids.companyA,
        effectiveFrom: "2026-08-06",
        licenseTypeId: ids.licenseA,
        purchasedQty: 4,
        reason: "purchase",
        vendorAccountId: ids.accountA,
      }),
    ).rejects.toThrow("CAPACITY_INPUT_INVALID");
  });

  it.each([
    ["pool_empty", ids.requestPool],
    ["provider_400", ids.requestProvider],
  ] as const)("kills duplicate blocked transitions and alerts for %s", async (source, requestId) => {
    const service = createCapacityService(database, { now: () => now });
    await service.observeNoSeat({ requestId, source });
    await service.observeNoSeat({ requestId, source });
    const evidence = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM license_request WHERE id = $1 AND state = 'blocked_no_seat') AS blocked,
         (SELECT count(*)::int FROM request_transition WHERE request_id = $1 AND to_state = 'blocked_no_seat') AS transitions,
         (SELECT actor_user_id::text FROM request_transition WHERE request_id = $1 AND to_state = 'blocked_no_seat' LIMIT 1) AS actor,
         (SELECT count(*)::int FROM alert_event WHERE subject_ref->>'requestId' = $1::text) AS alerts,
         (SELECT count(*)::int FROM alert_notification_delivery delivery
          JOIN alert_event event ON event.id = delivery.alert_event_id
          WHERE event.subject_ref->>'requestId' = $1::text AND delivery.phase = 'pending') AS recipients`,
      [requestId],
    );
    expect(evidence.rows[0]).toEqual({
      actor: "00000000-0000-0000-0000-000000000001",
      alerts: 1,
      blocked: 1,
      recipients: 2,
      transitions: 1,
    });
  });

  it("kills accepting client tenant scope on a trusted no-seat observation", async () => {
    const service = createCapacityService(database, { now: () => now });
    await expect(
      service.observeNoSeat({
        companyId: ids.companyA,
        requestId: ids.requestOtherTenant,
        source: "pool_empty",
      }),
    ).rejects.toThrow("CAPACITY_INPUT_INVALID");
    const state = await owner.query("SELECT state FROM license_request WHERE id = $1", [ids.requestOtherTenant]);
    expect(state.rows[0]).toEqual({ state: "approved" });
  });
});
