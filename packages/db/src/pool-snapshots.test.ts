import pg from "pg";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "./testing/postgres-container";
const implementationPath = process.env.POOL_SNAPSHOT_IMPLEMENTATION_PATH;
const { listCurrentSeatPoolCounts } = implementationPath
  ? await import(pathToFileURL(implementationPath).href)
  : await import("./pool-snapshots");

const id = (suffix: string) =>
  `23200000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  account: id("1"),
  admin: id("2"),
  capacityOld: id("3"),
  capacityNew: id("4"),
  license: id("5"),
  vendor: id("6"),
};

let fixture: PostgresFixture;
let owner: pg.Client;
let application: pg.Pool;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  application = new pg.Pool({ connectionString: fixture.appUrl, max: 1 });

  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES ($1,'admin@pool-snapshot.test','pool-snapshot-admin',
             'group_admin','es','active',$2)`,
    [ids.admin, new Date("2026-08-04T15:00:00.000Z")],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Snapshot Vendor','api','rest',true,true,false,false,
             'email','active',$2,$3)`,
    [ids.vendor, new Date("2026-08-04T15:00:00.000Z"), ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Snapshot Account','automated',1,'active',$3,$4)`,
    [
      ids.account,
      ids.vendor,
      new Date("2026-08-04T15:00:00.000Z"),
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Snapshot Seat','seat','active',$3,$4)`,
    [
      ids.license,
      ids.vendor,
      new Date("2026-08-04T15:00:00.000Z"),
      ids.admin,
    ],
  );
  await owner.query(
    `INSERT INTO vendor_account_capacity
       (id,vendor_account_id,license_type_id,purchased_qty,effective_from,
        created_at,created_by)
     VALUES ($1,$3,$4,2,'2026-08-01',$5,$6),
            ($2,$3,$4,7,'2026-08-04',$5,$6)`,
    [
      ids.capacityOld,
      ids.capacityNew,
      ids.account,
      ids.license,
      new Date("2026-08-04T15:00:00.000Z"),
      ids.admin,
    ],
  );
}, 120_000);

afterAll(async () => {
  await application?.end();
  await owner?.end();
  await fixture?.stop();
});

describe("US-023 pool snapshot contract with real PostgreSQL", () => {
  it("keeps purchased quantity paired with its effective date across operating dates", async () => {
    await expect(
      listCurrentSeatPoolCounts(application, {
        asOf: new Date("2026-08-04T16:00:00.000Z"),
        operatingDate: "2026-08-03",
      }),
    ).resolves.toEqual([
      {
        assigned: 0,
        contractRenewalOn: null,
        effectiveFrom: "2026-08-01",
        licenseTypeId: ids.license,
        licenseTypeName: "Snapshot Seat",
        lowPoolFloor: 1,
        mode: "automated",
        pendingInvites: 0,
        purchased: 2,
        vendorAccountId: ids.account,
        vendorAccountName: "Snapshot Account",
      },
    ]);

    await expect(
      listCurrentSeatPoolCounts(application, {
        asOf: new Date("2026-08-04T16:00:00.000Z"),
        operatingDate: "2026-08-04",
      }),
    ).resolves.toEqual([
      {
        assigned: 0,
        contractRenewalOn: null,
        effectiveFrom: "2026-08-04",
        licenseTypeId: ids.license,
        licenseTypeName: "Snapshot Seat",
        lowPoolFloor: 1,
        mode: "automated",
        pendingInvites: 0,
        purchased: 7,
        vendorAccountId: ids.account,
        vendorAccountName: "Snapshot Account",
      },
    ]);
  });
});
