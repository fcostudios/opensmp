import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, reclamationProposal } from "@smp/db/schema";
import { createReclamationServerActions } from "./reclamation-server-actions-factory";
import { createReclamationFixture, reclamationId } from "./testing/reclamation-fixture";
import type { LedgerAuthorization } from "../identity-access/authorization";

type Fixture = Awaited<ReturnType<typeof createReclamationFixture>>;
function action(f: Fixture, authorization: LedgerAuthorization | null = f.admin, revalidate: (path: string) => void = () => undefined) {
  return createReclamationServerActions({ database: f.database, loadAuthorization: async () => authorization, now: f.now, revalidate }).proposeReclamations;
}
const command = (f: Fixture) => ({ person_ids: [f.ids.person1, f.ids.person2, f.ids.person3], note: "  Inactividad revisada  ", client_request_id: f.ids.command1 });
async function effects(f: Fixture) {
  return { proposals: await f.database.select().from(reclamationProposal), audits: await f.database.select().from(auditLog).where(eq(auditLog.action, "reclamation.proposed")) };
}
describe("US-073 real audited batch action", () => {
  it.each([false, true])("creates every open selected assignment and preserves original retry effects (extra=%s)", async extraAssignment => {
    const f = await createReclamationFixture({ extraAssignment });
    try {
      const paths: string[] = [];
      const propose = action(f, f.admin, path => { paths.push(path); });
      const count = extraAssignment ? 4 : 3;
      expect(await propose(command(f))).toEqual({ status: "success", created: count, existing: 0 });
      const before = await effects(f);
      expect(before.proposals.map(p => p.assignmentId).sort()).toEqual(f.ids.openSelectedAssignments.slice().sort());
      expect(before.audits).toHaveLength(count);
      for (const p of before.proposals) {
        expect(p).toMatchObject({ status: "pending", proposedBy: f.ids.admin, proposalNote: "Inactividad revisada", createdAt: f.now() });
        const audit = before.audits.filter(a => a.entityId === p.id);
        expect(audit).toHaveLength(1);
        const companyId = p.assignmentId === f.ids.assignment2 ? f.ids.companyB : p.assignmentId === f.ids.assignment3 ? f.ids.companyC : f.ids.companyA;
        expect(audit[0]).toMatchObject({ actorUserId: f.ids.admin, companyId, entityType: "ReclamationProposal", note: p.proposalNote, before: null, occurredAt: f.now(), after: { assignment_id: p.assignmentId, proposed_by: f.ids.admin, proposal_note: "Inactividad revisada", status: "pending", client_request_id: f.ids.command1 } });
        expect(Object.keys(p)).not.toContain("client_request_id");
      }
      expect(paths).toEqual(["/uso"]);
      expect(await propose({ ...command(f), note: "changed", client_request_id: f.ids.command2 })).toEqual({ status: "success", created: 0, existing: count });
      expect(await effects(f)).toEqual(before);
      expect(paths).toEqual(["/uso"]);
    } finally { await f.stop(); }
  });
  it("refuses entire foreign, stale and unauthorized selections without a proposal or audit", async () => {
    const f = await createReclamationFixture();
    try {
      const negative = [
        [{ ...command(f), company_id: f.ids.companyA, person_ids: [f.ids.person1, f.ids.outsider] }, f.admin, "access_denied"],
        [{ ...command(f), person_ids: [f.ids.person1, reclamationId(999)] }, f.admin, "access_denied"],
        [{ ...command(f), company_id: reclamationId(999) }, f.admin, "access_denied"],
        [command(f), { ...f.admin, companyIds: [] }, "access_denied"],
        [command(f), { ...f.admin, companyIds: [f.ids.companyA] }, "access_denied"],
        [{ ...command(f), person_ids: [f.ids.person1, f.ids.noOpen] }, f.admin, "selection_changed"],
        [command(f), f.viewer, "access_denied"], [command(f), f.finance, "access_denied"], [command(f), null, "access_denied"],
        ...["approver", "company_finance", "employee"].map(role => [command(f), { ...f.viewer, roles: [role] }, "access_denied"]),
      ] as const;
      for (const [input, authorization, code] of negative) {
        expect(await action(f, authorization as LedgerAuthorization | null)(input)).toEqual({ status: "error", code });
        expect(await effects(f)).toEqual({ proposals: [], audits: [] });
      }
      const throwing = createReclamationServerActions({ database: f.database, loadAuthorization: async () => { throw new Error("private"); }, now: f.now, revalidate: () => undefined });
      expect(await throwing.proposeReclamations(command(f))).toEqual({ status: "error", code: "unexpected" });
    } finally { await f.stop(); }
  });
  it("validates the strict command and normalizes duplicate UUIDs and blank note", async () => {
    const f = await createReclamationFixture({ extraAssignment: false });
    try {
      const propose = action(f);
      const invalid = [null, {}, { ...command(f), actor: f.ids.admin }, { ...command(f), person_ids: [] }, { ...command(f), person_ids: Array.from({ length: 51 }, (_, n) => reclamationId(100 + n)) }, { ...command(f), person_ids: ["bad"] }, { ...command(f), company_id: "bad" }, { ...command(f), note: 1 }, { ...command(f), note: "x".repeat(2001) }, { ...command(f), client_request_id: "bad" }];
      for (const input of invalid) expect(await propose(input)).toEqual({ status: "error", code: "invalid_input" });
      expect(await effects(f)).toEqual({ proposals: [], audits: [] });
      expect(await propose({ person_ids: [f.ids.person1.toUpperCase(), f.ids.person1], client_request_id: f.ids.command1.toUpperCase(), note: "   " })).toEqual({ status: "success", created: 1, existing: 0 });
      expect((await effects(f)).proposals[0].proposalNote).toBeNull();
      expect((await effects(f)).audits[0].after).toMatchObject({ client_request_id: f.ids.command1 });
      expect(await propose({ person_ids: [f.ids.person2], client_request_id: f.ids.command2 })).toEqual({ status: "success", created: 1, existing: 0 });
      expect((await effects(f)).proposals.every(p => p.proposalNote === null)).toBe(true);
    } finally { await f.stop(); }
  });
  it("serializes concurrent batches and inserts only missing pending proposals alongside history", async () => {
    const f = await createReclamationFixture({ extraAssignment: false });
    try {
      await f.ownerDb.insert(reclamationProposal).values([{ assignmentId: f.ids.assignment1, status: "dismissed", createdAt: f.now() }, { assignmentId: f.ids.assignment2, status: "approved", createdAt: f.now() }]);
      expect(await action(f)({ person_ids: [f.ids.person1], client_request_id: f.ids.command1 })).toEqual({ status: "success", created: 1, existing: 0 });
      const results = await Promise.all([action(f)(command(f)), action(f)({ ...command(f), client_request_id: f.ids.command2 })]);
      expect(results.every(r => r.status === "success")).toBe(true);
      expect(results.map(r => r.status === "success" ? r.created : -100).reduce((a,b) => a+b, 0)).toBe(2);
      const { proposals, audits } = await effects(f);
      expect(proposals.filter(p => p.status === "pending")).toHaveLength(3);
      expect(audits).toHaveLength(3);
    } finally { await f.stop(); }
  });
  it("rolls back the whole batch when any audit insertion fails", async () => {
    const f = await createReclamationFixture();
    try {
      await f.owner.query(`CREATE FUNCTION reject_reclamation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='reclamation.proposed' AND NEW.after->>'assignment_id'='${f.ids.assignment2}' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_reclamation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_reclamation_audit()`);
      expect(await action(f)(command(f))).toEqual({ status: "error", code: "unexpected" });
      expect(await effects(f)).toEqual({ proposals: [], audits: [] });
    } finally { await f.owner.query("DROP TRIGGER IF EXISTS reject_reclamation_audit ON audit_log; DROP FUNCTION IF EXISTS reject_reclamation_audit()"); await f.stop(); }
  });
  it("rechecks an assignment closed while the batch waits for its row lock", async () => {
    const f = await createReclamationFixture({ extraAssignment: false });
    let pending: ReturnType<ReturnType<typeof action>> | undefined;
    try {
      await f.owner.query("BEGIN");
      await f.owner.query("UPDATE license_assignment SET ended_on='2026-10-10',end_reason='left_company' WHERE id=$1", [f.ids.assignment1]);
      const pid = (await f.owner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      pending = action(f)({ person_ids: [f.ids.person1], client_request_id: f.ids.command1 });
      const settled = pending.then(() => { throw new Error("batch did not wait for assignment lock"); });
      let waiting = false;
      for (let attempt = 0; attempt < 500 && !waiting; attempt++) {
        const result = await Promise.race([f.owner.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))", [pid]), settled]);
        waiting = result.rows.length > 0;
      }
      expect(waiting).toBe(true);
      await f.owner.query("COMMIT");
      expect(await pending).toEqual({ status: "error", code: "selection_changed" });
      expect(await effects(f)).toEqual({ proposals: [], audits: [] });
    } finally { await f.owner.query("ROLLBACK"); await pending; await f.stop(); }
  });
});
