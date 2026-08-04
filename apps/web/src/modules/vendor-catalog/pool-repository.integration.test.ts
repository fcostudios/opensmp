import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import { createAuthorizationRepository } from "../identity-access/authorization";
import {
  createPoolRepository,
  parseVendorAccountId,
  poolOperatingDate,
} from "./pool-repository";
import { loadLowPoolFacts } from "../../../../worker/src/alerts/low-pool-facts";

const id = (suffix: string) => `22000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  admin: id("1"),
  finance: id("2"),
  companyA: id("3"),
  companyB: id("4"),
  personA: id("5"),
  personB: id("6"),
  personFuture: id("12"),
  personCorrupt: id("13"),
  personApiA: id("14"),
  personApiB: id("15"),
  vendor: id("7"),
  accountLow: id("8"),
  accountEqual: id("9"),
  licenseStandard: id("10"),
  licenseApi: id("11"),
};
const evaluatedAt = new Date("2026-07-28T15:00:00.000Z");
const futureAt = new Date("2026-07-28T15:00:00.001Z");

let fixture: PostgresFixture | undefined;
let owner: pg.Client;
let authorizationPool: pg.Pool;
let applicationUrl: string;
let repository: ReturnType<typeof createPoolRepository>;
let repositoryClosed = false;
let adminAuthorization: NonNullable<
  Awaited<ReturnType<ReturnType<typeof createAuthorizationRepository>["load"]>>
>;
let financeAuthorization: typeof adminAuthorization;

beforeAll(async () => {
  const mutationAppUrl = process.env.US022_MUTATION_DATABASE_URL;
  const mutationOwnerUrl = process.env.US022_MUTATION_DATABASE_ADMIN_URL;
  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error("US-022 mutation harness requires both database URLs");
    }
    applicationUrl = mutationAppUrl;
    owner = new pg.Client({ connectionString: mutationOwnerUrl });
    await owner.connect();
  } else {
    fixture = await createPostgresFixture();
    await fixture.migrate();
    applicationUrl = fixture.appUrl;
    owner = await fixture.connectAsOwner();
  }
  await owner.query(
    `TRUNCATE TABLE alert_notification_delivery, alert_event, activity_record, cost_record, provisioning_action,
       license_request, vendor_account_capacity, license_assignment, license_type,
       vendor_account, vendor, person, company, user_account
     RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ($1,'admin@pool.test','pool-admin','group_admin','es','active',$3),
       ($2,'finance@pool.test','pool-finance','central_finance','es','active',$3)`,
    [ids.admin, ids.finance, evaluatedAt],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,statement_language,created_at,created_by)
     VALUES
       ($1,'Company A','PA','internal','active','es',$3,$4),
       ($2,'Company B','PB','external','active','es',$3,$4)`,
    [ids.companyA, ids.companyB, evaluatedAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES
       ($1,'a@pool.test','Pool A',$3,'active',$5,$6),
       ($2,'b@pool.test','Pool B',$4,'active',$5,$6),
       ($7,'future@pool.test','Pool Future',$3,'active',$5,$6),
       ($8,'corrupt@pool.test','Pool Corrupt',$3,'active',$5,$6),
       ($9,'api-a@pool.test','Pool API A',$3,'active',$5,$6),
       ($10,'api-b@pool.test','Pool API B',$4,'active',$5,$6)`,
    [
      ids.personA,
      ids.personB,
      ids.companyA,
      ids.companyB,
      evaluatedAt,
      ids.admin,
      ids.personFuture,
      ids.personCorrupt,
      ids.personApiA,
      ids.personApiB,
    ],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Anthropic','api','rest',true,true,true,true,'email','active',$2,$3)`,
    [ids.vendor, evaluatedAt, ids.admin],
  );
  await owner.query(
     `INSERT INTO vendor_account
       (id,vendor_id,name,mode,contract_renewal_on,low_pool_floor,status,created_at,created_by)
     VALUES
       ($1,$3,'Low pool','automated','2027-03-01',9,'active',$4,$5),
       ($2,$3,'At floor','orchestration','2027-09-30',5,'active',$4,$5)`,
    [
      ids.accountLow,
      ids.accountEqual,
      ids.vendor,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES
       ($1,$3,'Standard','seat','active',$4,$5),
       ($2,$3,'API','seat','active',$4,$5)`,
    [
      ids.licenseStandard,
      ids.licenseApi,
      ids.vendor,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
     `INSERT INTO vendor_account_capacity
       (vendor_account_id,license_type_id,purchased_qty,effective_from,note,created_at,created_by)
     VALUES
       ($1,$3,10,'2026-07-01','old',$5,$6),
       ($1,$3,12,'2026-07-20','current',$5,$6),
       ($1,$3,30,'2026-08-01','future',$5,$6),
       ($1,$4,1,'2026-07-01','oversubscribed',$5,$6),
       ($2,$3,5,'2026-07-01','equal floor',$5,$6)`,
    [
      ids.accountLow,
      ids.accountEqual,
      ids.licenseStandard,
      ids.licenseApi,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO vendor_account_capacity
       (vendor_account_id,license_type_id,purchased_qty,effective_from,note,
        created_at,created_by)
     VALUES ($1,$2,99,'2026-07-25','created after snapshot',$3,$4)`,
    [ids.accountLow, ids.licenseStandard, futureAt, ids.admin],
  );
  await owner.query(
    `INSERT INTO alert_rule
       (type,scope_kind,threshold,channel,enabled,created_at,created_by)
     VALUES ('low_pool','global','{"floor":5}','email',true,$1,$2)`,
    [evaluatedAt, ids.admin],
  );
  await owner.query(
     `INSERT INTO license_assignment
       (person_id,company_id,vendor_account_id,license_type_id,started_on,ended_on,
        source_kind,created_at,created_by)
     VALUES
       ($1,$3,$5,$6,'2026-01-01',NULL,'import',$8,$9),
       ($2,$4,$5,$6,'2026-01-01',NULL,'import',$8,$9),
       ($1,$3,$5,$6,'2025-01-01','2025-12-31','import',$8,$9),
       ($10,$4,$5,$6,'2026-01-01',NULL,'import',$8,$9),
       ($11,$3,$5,$7,'2026-01-01',NULL,'import',$8,$9),
       ($12,$4,$5,$7,'2026-01-01',NULL,'import',$8,$9)`,
    [
      ids.personA,
      ids.personB,
      ids.companyA,
      ids.companyB,
      ids.accountLow,
      ids.licenseStandard,
      ids.licenseApi,
      evaluatedAt,
      ids.admin,
      ids.personCorrupt,
      ids.personApiA,
      ids.personApiB,
    ],
  );
  await owner.query(
    `INSERT INTO license_assignment
       (person_id,company_id,vendor_account_id,license_type_id,started_on,
        ended_on,source_kind,created_at,created_by)
     VALUES ($1,$2,$3,$4,'2026-01-01',NULL,'import',$5,$6)`,
    [
      ids.personFuture,
      ids.companyA,
      ids.accountLow,
      ids.licenseStandard,
      futureAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO activity_record
       (vendor_account_id,person_id,activity_date,counters,synced_at)
     VALUES ($1,$2,'2026-06-01','{}',$3)`,
    [ids.accountLow, ids.personA, evaluatedAt],
  );
  await owner.query(
    `INSERT INTO cost_record
       (vendor_account_id,person_id,cost_date,amount_usd,synced_at)
     VALUES ($1,$2,'2026-07-15',42.50,$3)`,
    [ids.accountLow, ids.personA, evaluatedAt],
  );

  const requestRows = [
    ["1", ids.personA, ids.companyA, ids.accountLow, ids.licenseStandard],
    ["2", ids.personB, ids.companyB, ids.accountLow, ids.licenseStandard],
    ["3", ids.personA, ids.companyA, ids.accountLow, ids.licenseStandard],
    ["4", ids.personA, ids.companyA, ids.accountLow, ids.licenseStandard],
    ["5", ids.personA, ids.companyA, ids.accountLow, ids.licenseStandard],
    ["6", ids.personA, ids.companyA, ids.accountLow, ids.licenseApi],
    ["7", ids.personA, ids.companyB, ids.accountLow, ids.licenseStandard],
  ] as const;
  for (const [suffix, personId, companyId, accountId, licenseId] of requestRows) {
    await owner.query(
      `INSERT INTO license_request
         (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,
          justification,created_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'provisioning','pool test',$7,$8)`,
      [
        id(`10${suffix}`),
        `POOL-${suffix}`,
        personId,
        companyId,
        accountId,
        licenseId,
        evaluatedAt,
        ids.admin,
      ],
    );
  }
  const actionRows = [
    ["1", "invite", "automated", "pending"],
    ["2", "invite", "automated", "sent"],
    ["3", "invite", "automated", "confirmed"],
    ["4", "checklist", "orchestration", "pending"],
    ["5", "invite", "orchestration", "pending"],
    ["6", "invite", "automated", "pending"],
    ["7", "invite", "automated", "pending"],
  ] as const;
  for (const [suffix, kind, mode, status] of actionRows) {
    await owner.query(
      `INSERT INTO provisioning_action
         (request_id,vendor_account_id,kind,mode,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id(`10${suffix}`), ids.accountLow, kind, mode, status, evaluatedAt],
    );
  }
  await owner.query(
    `INSERT INTO license_request
       (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,
        justification,created_at,created_by)
     VALUES ($1,'POOL-FUTURE',$2,$3,$4,$5,'provisioning',
             'future action must not affect an earlier snapshot',$6,$7)`,
    [
      id("108"),
      ids.personA,
      ids.companyA,
      ids.accountLow,
      ids.licenseStandard,
      evaluatedAt,
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO provisioning_action
       (request_id,vendor_account_id,kind,mode,status,created_at)
     VALUES ($1,$2,'invite','automated','pending',$3)`,
    [
      id("108"),
      ids.accountLow,
      futureAt,
    ],
  );

  authorizationPool = new pg.Pool({ connectionString: applicationUrl });
  const database = drizzle(authorizationPool, {
    schema,
  });
  const authorizationRepository = createAuthorizationRepository(database);
  const [loadedAdmin, loadedFinance] = await Promise.all([
    authorizationRepository.load({ subject: "pool-admin" }),
    authorizationRepository.load({ subject: "pool-finance" }),
  ]);
  if (!loadedAdmin || !loadedFinance) throw new Error("authorization fixture failed");
  adminAuthorization = loadedAdmin;
  financeAuthorization = loadedFinance;
  repository = createPoolRepository(applicationUrl);
}, 120_000);

afterAll(async () => {
  await Promise.all([
    repository && !repositoryClosed ? repository.close() : Promise.resolve(),
    authorizationPool?.end(),
    owner?.end(),
  ]);
  if (fixture) await fixture.stop();
});

describe("US-022 pool repository with real PostgreSQL", () => {
  it("requires a valid injected date and derives the exact Ecuador operating date", async () => {
    expect(poolOperatingDate(evaluatedAt)).toBe("2026-07-28");
    expect(poolOperatingDate(new Date("2026-07-28T04:59:59.999Z"))).toBe(
      "2026-07-27",
    );
    expect(poolOperatingDate(new Date("2026-07-28T05:00:00.000Z"))).toBe(
      "2026-07-28",
    );
    expect(() => poolOperatingDate(new Date(Number.NaN))).toThrow(
      "at must be a valid Date",
    );
    await expect(
      repository.listSnapshots(adminAuthorization, new Date(Number.NaN)),
    ).rejects.toThrow("at must be a valid Date");
    expect(parseVendorAccountId(ids.accountLow)).toBe(ids.accountLow);
    expect(parseVendorAccountId("not-a-uuid")).toBeNull();
  });

  it("uses latest effective capacity, open assignments, and automated pending invites only", async () => {
    const snapshots = await repository.listSnapshots(
      adminAuthorization,
      evaluatedAt,
    );

    expect(snapshots).toEqual([
      expect.objectContaining({
        assigned: 2,
        decisionEvidence: {
          type: "candidates",
          items: [{
            assignmentId: expect.any(String),
            lastActiveOn: "2026-06-01",
            monthlyCostUsd: 42.5,
          }],
        },
        free: 8,
        licenseTypeId: ids.licenseStandard,
        pendingInvites: 2,
        purchased: 12,
        isLow: true,
        vendorAccountId: ids.accountLow,
      }),
      expect.objectContaining({
        assigned: 2,
        free: -2,
        licenseTypeId: ids.licenseApi,
        pendingInvites: 1,
        purchased: 1,
        isLow: true,
        vendorAccountId: ids.accountLow,
      }),
      expect.objectContaining({
        assigned: 0,
        free: 5,
        licenseTypeId: ids.licenseStandard,
        pendingInvites: 0,
        purchased: 5,
        isLow: false,
        vendorAccountId: ids.accountEqual,
      }),
    ]);
  });

  it("authorizes pool truth from the Ledger DB global role", async () => {
    await expect(
      repository.listSnapshots(financeAuthorization, evaluatedAt),
    ).rejects.toThrow("POOL_ACCESS_FORBIDDEN");
  });

  it("enforces nonnegative purchased capacity and account floors at runtime", async () => {
    await expect(
      authorizationPool.query(
        "UPDATE vendor_account SET low_pool_floor = -1 WHERE id = $1",
        [ids.accountLow],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "vendor_account_low_pool_floor_nonnegative",
    });
    await expect(
      authorizationPool.query(
        `INSERT INTO vendor_account_capacity
           (vendor_account_id,license_type_id,purchased_qty,effective_from,
            created_at,created_by)
         VALUES ($1,$2,-1,'2026-07-28',$3,$4)`,
        [ids.accountLow, ids.licenseStandard, evaluatedAt, ids.admin],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "vendor_account_capacity_purchased_qty_nonnegative",
    });
  });

  it("feeds the scheduled worker from the same scoped pool truth", async () => {
    await expect(
      loadLowPoolFacts(authorizationPool, {
        at: evaluatedAt,
        vendorAccountId: ids.accountLow,
      }),
    ).resolves.toEqual([
      {
        free: 8,
        lowPoolFloor: 9,
        subject: {
          licenseTypeId: ids.licenseStandard,
          vendorAccountId: ids.accountLow,
        },
      },
      {
        free: -2,
        lowPoolFloor: 9,
        subject: {
          licenseTypeId: ids.licenseApi,
          vendorAccountId: ids.accountLow,
        },
      },
    ]);
  });

  it("closes its database resources", async () => {
    await repository.close();
    repositoryClosed = true;
    await expect(
      repository.listSnapshots(adminAuthorization, evaluatedAt),
    ).rejects.toThrow();
  });
});
