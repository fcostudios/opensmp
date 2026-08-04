import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@smp/db/schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import { createAuthorizationRepository } from "../../identity-access/authorization";
import { createCapacityService } from "../capacity-service";
import { createManageCapacityActions } from "./manage-capacity-operations";

const id = (suffix: string) =>
  `23200000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const now = new Date("2026-08-04T15:00:00.000Z");
let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(`INSERT INTO user_account
    (id,email,idp_subject,global_role,ui_language,status,created_at)
    VALUES ($1,'actions@capacity.test','capacity-actions','group_admin','en','active',$2)`,
    [id("1"), now]);
  await owner.query(`INSERT INTO vendor
    (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
     has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
    VALUES ($1,'Action Vendor','orchestration','none',false,false,false,false,
      'email','active',$2,$3)` , [id("2"), now, id("1")]);
  await owner.query(`INSERT INTO vendor_account
    (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
    VALUES ($1,$2,'Action Account','orchestration',1,'active',$3,$4)`,
    [id("3"), id("2"), now, id("1")]);
  await owner.query(`INSERT INTO license_type
    (id,vendor_id,name,unit,status,created_at,created_by)
    VALUES ($1,$2,'Action Seat','seat','active',$3,$4)`,
    [id("4"), id("2"), now, id("1")]);
}, 120_000);

afterAll(async () => {
  await Promise.all([pool?.end(), owner?.end()]);
  await fixture?.stop();
});

describe("US-023 capacity server actions", () => {
  it("parses FormData reasons, authorizes, audits, and revalidates both views", async () => {
    const database = drizzle(pool, { schema });
    const authorizationRepository = createAuthorizationRepository(database);
    const paths: string[] = [];
    const actions = createManageCapacityActions({
      loadAuthorization: () => authorizationRepository.load({ subject: "capacity-actions" }),
      revalidate: (path) => paths.push(path),
      service: createCapacityService(database, { now: () => now }),
    });
    const form = (effectiveFrom: string, purchasedQty: string, reason?: string) => {
      const input = new FormData();
      input.set("effectiveFrom", effectiveFrom);
      input.set("licenseTypeId", id("4"));
      input.set("purchasedQty", purchasedQty);
      input.set("vendorAccountId", id("3"));
      if (reason) input.set("reason", reason);
      return input;
    };

    await actions.registerPurchase(form("2026-08-10", "3"));
    await actions.addCapacity(form("2026-08-11", "4"));
    await actions.addCapacity(form("2026-08-12", "5", "correction"));
    await actions.saveVendorAccountCapacity(form("2026-08-13", "6"));

    const evidence = await owner.query(
      `SELECT capacity.purchased_qty,capacity.effective_from::text,
              audit.after->>'reason' AS reason
       FROM vendor_account_capacity capacity JOIN audit_log audit
         ON audit.entity_id=capacity.id AND audit.action='capacity.changed'
       ORDER BY capacity.effective_from`,
    );
    expect(evidence.rows).toEqual([
      { effective_from: "2026-08-10", purchased_qty: 3, reason: "purchase" },
      { effective_from: "2026-08-11", purchased_qty: 4, reason: "purchase" },
      { effective_from: "2026-08-12", purchased_qty: 5, reason: "correction" },
      { effective_from: "2026-08-13", purchased_qty: 6, reason: "correction" },
    ]);
    expect(paths).toEqual([
      "/cupos", "/excepciones", "/cupos", "/excepciones",
      "/cupos", "/excepciones", "/cupos", "/excepciones",
    ]);

    const forbidden = createManageCapacityActions({
      loadAuthorization: () => authorizationRepository.load({ subject: "missing" }),
      revalidate: (path) => paths.push(path),
      service: createCapacityService(database, { now: () => now }),
    });
    await expect(forbidden.registerPurchase(form("2026-08-14", "7")))
      .rejects.toThrow("CAPACITY_ACCESS_FORBIDDEN");
    await expect(owner.query(
      "SELECT count(*)::int AS count FROM vendor_account_capacity",
    )).resolves.toMatchObject({ rows: [{ count: 4 }] });
  });
});
