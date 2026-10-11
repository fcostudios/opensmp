import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
// eslint-disable-next-line no-restricted-imports -- Test-only fixture owns real committed-migration PostgreSQL setup.
import { createPostgresFixture } from "@smp/db/testing/postgres-container";
// eslint-disable-next-line no-restricted-imports -- Test-only deterministic seed runs as ledger_owner; exercised commands use ledger_app.
import * as schema from "@smp/db/schema";
import { createAuthorizationRepository } from "../../identity-access/authorization";

export const reclamationId = (n: number) => `00000000-0000-4000-8000-000000730${String(n).padStart(3, "0")}`;
export async function createReclamationFixture({ extraAssignment = true } = {}) {
  const fixture = await createPostgresFixture();
  await fixture.migrate();
  const owner = await fixture.connectAsOwner();
  const ownerDb = drizzle(owner, { schema });
  const appPool = new pg.Pool({ connectionString: fixture.appUrl });
  const database = drizzle(appPool, { schema });
  try {
  const names = ["admin", "viewer", "finance", "companyA", "companyB", "companyC", "vendor", "account", "type", "person1", "person2", "person3", "outsider", "noOpen", "assignment1", "assignment2", "assignment3", "assignmentExtra", "assignmentEnded", "assignmentOutsider", "request1", "request2", "request3", "command1", "command2"] as const;
  const ids = Object.fromEntries(names.map((name, n) => [name, reclamationId(n + 1)])) as Record<typeof names[number], string>;
  const at = new Date("2026-10-10T12:00:00.000Z");
  const authored = { createdAt: at, createdBy: ids.admin };
  await ownerDb.insert(schema.userAccount).values([
    { id: ids.admin, email: "reclamation.admin@example.com", idpSubject: "reclamation-admin", globalRole: "group_admin", status: "active", createdAt: at },
    { id: ids.viewer, email: "reclamation.viewer@example.com", idpSubject: "reclamation-viewer", status: "active", createdAt: at },
    { id: ids.finance, email: "reclamation.finance@example.com", idpSubject: "reclamation-finance", globalRole: "central_finance", status: "active", createdAt: at },
  ]);
  await ownerDb.insert(schema.company).values([ids.companyA, ids.companyB, ids.companyC].map((id, n) => ({ id, name: `Company ${"ABC"[n]}`, code: `R${n}`, type: "internal" as const, status: "active" as const, ...authored })));
  await ownerDb.insert(schema.companyRoleAssignment).values({ userAccountId: ids.viewer, companyId: ids.companyA, role: "viewer", uniqueGrant: "reclamation-viewer-a", ...authored });
  await ownerDb.insert(schema.vendor).values({ id: ids.vendor, name: "Reclamation Vendor", connectorType: "orchestration", provisioningProtocol: "none", canProvision: false, canDeprovision: false, hasUsageData: true, hasCostData: false, identityMatching: "email", status: "active", ...authored });
  await ownerDb.insert(schema.vendorAccount).values({ id: ids.account, vendorId: ids.vendor, name: "Reclamation Account", mode: "orchestration", lowPoolFloor: 1, status: "active", ...authored });
  await ownerDb.insert(schema.licenseType).values([
    { id: ids.type, vendorId: ids.vendor, name: "Enterprise", unit: "seat", status: "active", ...authored },
    { id: reclamationId(50), vendorId: ids.vendor, name: "Standard", unit: "seat", status: "active", ...authored },
  ]);
  const people = [[ids.person1, ids.companyA, "Ana"], [ids.person2, ids.companyB, "Bea"], [ids.person3, ids.companyC, "Cora"], [ids.outsider, ids.companyB, "Outsider"], [ids.noOpen, ids.companyA, "No open license"]] as const;
  await ownerDb.insert(schema.person).values(people.map(([id, companyId, fullName]) => ({ id, companyId, fullName, email: `${id}@example.com`, status: "active" as const, ...authored })));
  const selected = [ids.person1, ids.person2, ids.person3];
  const companies = [ids.companyA, ids.companyB, ids.companyC];
  const requests = [ids.request1, ids.request2, ids.request3];
  await ownerDb.insert(schema.licenseRequest).values(selected.map((personId, n) => ({ id: requests[n], requestNo: `RECLAMATION-${n}`, personId, companyId: companies[n], vendorAccountId: ids.account, licenseTypeId: ids.type, state: "flagged_inactive" as const, justification: "fixture", ...authored })));
  const assignments = [ids.assignment1, ids.assignment2, ids.assignment3];
  const assignment = (id: string, personId: string, companyId: string, sourceRequestId: string | null = null) => ({ id, personId, companyId, sourceRequestId, vendorAccountId: ids.account, licenseTypeId: ids.type, startedOn: "2026-08-01", sourceKind: "import" as const, ...authored });
  await ownerDb.insert(schema.licenseAssignment).values([
    ...selected.map((personId, n) => assignment(assignments[n], personId, companies[n], requests[n])),
    ...(extraAssignment ? [{ ...assignment(ids.assignmentExtra, ids.person1, ids.companyA, ids.request1), licenseTypeId: reclamationId(50) }] : []),
    { ...assignment(ids.assignmentEnded, ids.person1, ids.companyA), startedOn: "2026-01-01", endedOn: "2026-07-31", endReason: "left_company" as const },
    assignment(ids.assignmentOutsider, ids.outsider, ids.companyB),
  ]);
  const auth = createAuthorizationRepository(database);
  const admin = (await auth.load({ subject: "reclamation-admin" }))!;
  const viewer = (await auth.load({ subject: "reclamation-viewer" }))!;
  const finance = (await auth.load({ subject: "reclamation-finance" }))!;
  return { fixture, owner, ownerDb, appPool, database, admin, viewer, finance,
    ids: { ...ids, openSelectedAssignments: [...assignments, ...(extraAssignment ? [ids.assignmentExtra] : [])] }, now: () => new Date(at),
    async stop() { await appPool.end(); await owner.end(); await fixture.stop(); },
  };
  } catch (error) {
    await appPool.end(); await owner.end(); await fixture.stop();
    throw error;
  }
}
