import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import { createAuthorizationRepository } from "../../identity-access/authorization";

export const usageId = (n: number) => `00000000-0000-4000-8000-${String(720000 + n).padStart(12, "0")}`;
export const usageIds = { admin: usageId(1), viewer: usageId(2), companyA: usageId(3), companyB: usageId(4), emptyCompany: usageId(5), vendor: usageId(6), accountX: usageId(7), accountY: usageId(8), typeA: usageId(9), typeB: usageId(10), old: usageId(11), active: usageId(12), zero: usageId(13), unknown: usageId(14), absent: usageId(15), coworkFile: usageId(16), coworkSession: usageId(17), foreign: usageId(18), requestOld: usageId(19), foreignRequest: usageId(20) };
export const USAGE_EVALUATION_DATE = "2026-10-10";

/** Deterministic test-only seed; exercised reads always use ledger_app. */
export async function createUsageFixture() {
  const fixture = await createPostgresFixture();
  await fixture.migrate();
  const owner = await fixture.connectAsOwner();
  const ownerDb = drizzle(owner, { schema });
  const appPool = new pg.Pool({ connectionString: fixture.appUrl });
  const database = drizzle(appPool, { schema });
  const i = usageIds;
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const authored = { createdAt, createdBy: i.admin };
  await ownerDb.insert(schema.userAccount).values([
    { id: i.admin, email: "usage.admin@example.com", idpSubject: "usage-admin", globalRole: "group_admin", status: "active", createdAt },
    { id: i.viewer, email: "usage.viewer@example.com", idpSubject: "usage-viewer", status: "active", createdAt },
  ]);
  await ownerDb.insert(schema.company).values([
    { id: i.companyA, name: "Company A", code: "USA", type: "internal", status: "active", ...authored },
    { id: i.companyB, name: "Company B", code: "USB", type: "internal", status: "active", ...authored },
    { id: i.emptyCompany, name: "Empty Company", code: "USE", type: "internal", status: "active", ...authored },
  ]);
  await ownerDb.insert(schema.companyRoleAssignment).values({ userAccountId: i.viewer, companyId: i.companyA, role: "viewer", uniqueGrant: "usage-viewer-a", ...authored });
  await ownerDb.insert(schema.vendor).values({ id: i.vendor, name: "Usage Vendor", connectorType: "orchestration", provisioningProtocol: "none", canProvision: false, canDeprovision: false, hasUsageData: true, hasCostData: false, identityMatching: "email", status: "active", ...authored });
  await ownerDb.insert(schema.vendorAccount).values([
    { id: i.accountX, vendorId: i.vendor, name: "Account X", mode: "orchestration", lowPoolFloor: 1, status: "active", ...authored },
    { id: i.accountY, vendorId: i.vendor, name: "Account Y", mode: "orchestration", lowPoolFloor: 1, status: "active", ...authored },
  ]);
  await ownerDb.insert(schema.licenseType).values([
    { id: i.typeA, vendorId: i.vendor, name: "Enterprise", unit: "seat", status: "active", ...authored },
    { id: i.typeB, vendorId: i.vendor, name: "Standard", unit: "seat", status: "active", ...authored },
  ]);
  const people = [[i.old, "Last known Ana"], [i.active, "Current Ada"], [i.zero, "Zero Zoe"], [i.unknown, "Unknown Uma"], [i.absent, "Missing Mia"], [i.coworkFile, "Cowork file"], [i.coworkSession, "Cowork file session"], [i.foreign, "Foreign Bea"]] as const;
  await ownerDb.insert(schema.person).values(people.map(([id, fullName]) => ({ id, fullName, email: `${id}@example.com`, companyId: id === i.foreign ? i.companyB : i.companyA, status: "active" as const, ...authored })));
  await ownerDb.insert(schema.licenseRequest).values([
    { id: i.requestOld, requestNo: "USAGE-OLD", personId: i.old, companyId: i.companyA, vendorAccountId: i.accountX, licenseTypeId: i.typeA, state: "flagged_inactive", justification: "fixture", ...authored },
    { id: i.foreignRequest, requestNo: "USAGE-FOREIGN", personId: i.foreign, companyId: i.companyB, vendorAccountId: i.accountX, licenseTypeId: i.typeA, state: "offboarding", justification: "fixture", ...authored },
  ]);
  const assignment = (n: number, personId: string, accountId = i.accountX, typeId = i.typeA, sourceRequestId: string | null = null) => ({ id: usageId(n), personId, companyId: personId === i.foreign ? i.companyB : i.companyA, vendorAccountId: accountId, licenseTypeId: typeId, sourceRequestId, startedOn: "2026-08-01", sourceKind: "import" as const, ...authored });
  await ownerDb.insert(schema.licenseAssignment).values([
    assignment(30, i.old, i.accountX, i.typeA, i.requestOld), assignment(31, i.old, i.accountX, i.typeB, i.requestOld),
    assignment(32, i.old, i.accountY), assignment(33, i.active), assignment(34, i.zero), assignment(35, i.unknown), assignment(36, i.absent),
    assignment(37, i.coworkFile), assignment(38, i.coworkSession), assignment(39, i.foreign, i.accountX, i.typeA, i.foreignRequest),
    { ...assignment(40, i.active), startedOn: "2026-01-01", endedOn: "2026-07-31", endReason: "left_company" as const },
  ]);
  const observation = (personId: string, activityDate: string, counters: unknown, vendorAccountId = i.accountX) => ({ personId, vendorAccountId, activityDate, counters, syncedAt: new Date("2026-10-10T00:00:00Z"), source: "manual" as const });
  await ownerDb.insert(schema.activityRecord).values([
    observation(i.old, "2026-09-06", { chat_metrics: { message_count: 1 } }), observation(i.old, "2026-10-06", { chat_metrics: null }),
    observation(i.old, "2026-09-01", { chat_metrics: { message_count: 1 } }, i.accountY), observation(i.old, "2026-10-01", { chat_metrics: { message_count: 0 } }, i.accountY),
    observation(i.active, "2026-10-07", { chat_metrics: { message_count: 1 } }),
    observation(i.zero, "2026-10-06", { chat_metrics: { message_count: 0 } }), observation(i.unknown, "2026-10-06", { cowork_metrics: null }),
    observation(i.coworkFile, "2026-10-07", { cowork_metrics: { file_edit_count: 1 } }), observation(i.coworkSession, "2026-10-07", { cowork_metrics: { sessions_with_file_edits_count: 1 } }),
    observation(i.foreign, "2026-10-07", { chat_metrics: { message_count: 0 } }),
  ]);
  const auth = createAuthorizationRepository(database);
  const admin = (await auth.load({ subject: "usage-admin" }))!;
  const viewer = (await auth.load({ subject: "usage-viewer" }))!;
  return { fixture, owner, ownerDb, appPool, database, admin, viewer,
    async stop() { await appPool.end(); await owner.end(); await fixture.stop(); },
  };
}
