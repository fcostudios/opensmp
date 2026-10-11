// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activityRecord, auditLog, licenseAssignment, reclamationProposal } from "@smp/db/schema";
import { eq } from "drizzle-orm";
import es from "../../../messages/es-EC.json";
import { createReclamationFixture } from "../../modules/usage/testing/reclamation-fixture";
import { createUsageRepository } from "../../modules/usage/repository";
import { createReclamationServerActions } from "../../modules/usage/reclamation-server-actions-factory";
import { UsageView } from "./usage-view";
import { createReclamationSelectionStore } from "./reclamation-selection-store";

afterEach(cleanup);
type Fixture = Awaited<ReturnType<typeof createReclamationFixture>>;
const labels = es.usage;
const model = (f: Fixture, companyId?: string) => createUsageRepository(f.database).read(f.admin, { window: 30, companyId }, "2026-10-10");
const action = (f: Fixture, revalidate: (path: string) => void | Promise<void> = () => undefined) => createReclamationServerActions({ database: f.database, loadAuthorization: async () => f.admin, now: f.now, revalidate }).proposeReclamations;
const selected = (f: Fixture) => [f.ids.person1, f.ids.person2, f.ids.person3];
async function openThree(f: Fixture, user: ReturnType<typeof userEvent.setup>) {
  for (const id of selected(f)) await user.click(screen.getByTestId(`select_person_${id}`));
  await user.click(screen.getByTestId("btn_propose_reclamation"));
}
describe("US-073 real usage selection and proposal dialog", () => {
  it("atomically owns submissions, preserves unchanged retries and rejects stale generations", () => {
    const store = createReclamationSelectionStore();
    const person = "00000000-0000-4000-8000-000000730010";
    const first = "00000000-0000-4000-8000-000000730024";
    const second = "00000000-0000-4000-8000-000000730025";
    expect(store.getState().beginSubmission(undefined, () => first)).toBeNull();
    store.getState().togglePerson(person); store.getState().openDialog(); store.getState().setNote(" first ");
    const submission = store.getState().beginSubmission(undefined, () => first)!;
    expect(submission.command).toMatchObject({ person_ids: [person], note: "first", client_request_id: first });
    store.getState().setNote("ignored"); store.getState().togglePerson(person); store.getState().closeDialog();
    expect(store.getState()).toMatchObject({ note: " first ", selectedPersonIds: [person], open: true, submitting: true });
    expect(store.getState().beginSubmission(undefined, () => second)).toBeNull();
    store.getState().finishSubmission(submission, { status: "error", code: "unexpected" });
    expect(store.getState().beginSubmission(undefined, () => second)!.command.client_request_id).toBe(first);
    store.getState().reset();
    store.getState().finishSubmission(submission, { status: "success", created: 1, existing: 0 });
    expect(store.getState()).toMatchObject({ result: null, open: false, submitting: false, selectedPersonIds: [] });
    store.getState().togglePerson(person); store.getState().openDialog();
    const next = store.getState().beginSubmission(undefined, () => second)!;
    store.getState().finishSubmission(next, { status: "error", code: "selection_changed" });
    store.getState().setNote("changed");
    expect(store.getState().requestId).toBeNull();
    expect(store.getState().beginSubmission(undefined, () => first)!.command.client_request_id).toBe(first);
  });
  it("rejects invalid client commands without entering pending and permits the exact note limit", () => {
    const store = createReclamationSelectionStore();
    const id = "00000000-0000-4000-8000-000000730010";
    store.getState().togglePerson(id); store.getState().openDialog();
    expect(store.getState().beginSubmission(undefined, () => "invalid")).toBeNull();
    expect(store.getState()).toMatchObject({ submitting: false, result: { status: "error", code: "invalid_input" } });
    store.getState().setNote("x".repeat(2001));
    expect(store.getState().beginSubmission(undefined, () => id)).toBeNull();
    store.getState().setNote("x".repeat(2000));
    expect(store.getState().beginSubmission(undefined, () => id)!.command.note).toHaveLength(2000);
  });
  it("proposes three flagged people with note and authenticated actor through the rendered action", async () => {
    const f = await createReclamationFixture({ extraAssignment: false });
    try {
      const user = userEvent.setup();
      render(<UsageView model={await model(f)} locale="es-EC" labels={labels} propose={action(f)} requestId={() => f.ids.command1} />);
      expect((screen.getByTestId("btn_propose_reclamation") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId(`select_person_${f.ids.outsider}`) as HTMLInputElement).disabled).toBe(true);
      await openThree(f, user);
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByTestId("selected_summary").textContent).toContain("3");
      for (const name of ["Ana", "Bea", "Cora", "Company A", "Company B", "Company C"]) expect(dialog.textContent).toContain(name);
      expect(document.activeElement).toBe(screen.getByTestId("note"));
      await user.type(screen.getByTestId("note"), "Revisar inactividad");
      await user.click(screen.getByTestId("btn_send_proposals"));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain(labels.proposal.success.replace("{created}", "3").replace("{existing}", "0")));
      const pending = await f.database.select().from(reclamationProposal).where(eq(reclamationProposal.status, "pending"));
      expect(pending).toHaveLength(3);
      expect(pending.map(p => p.assignmentId).sort()).toEqual(f.ids.openSelectedAssignments.slice().sort());
      expect(pending.every(p => p.proposalNote === "Revisar inactividad" && p.proposedBy === f.ids.admin)).toBe(true);
      const audits = await f.database.select().from(auditLog).where(eq(auditLog.action, "reclamation.proposed"));
      expect(audits).toHaveLength(3);
      expect(audits.every(a => (a.after as {client_request_id: string}).client_request_id === f.ids.command1)).toBe(true);
      await user.click(within(dialog).getByRole("button", { name: labels.proposal.close }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(screen.getByTestId(`select_person_${f.ids.person1}`));
      expect((screen.getByTestId(`select_person_${f.ids.person1}`) as HTMLInputElement).checked).toBe(false);
      await openThree(f, user);
      await user.click(screen.getByTestId("btn_send_proposals"));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain(labels.proposal.success.replace("{created}", "0").replace("{existing}", "3")));
      expect(await f.database.select().from(reclamationProposal)).toEqual(pending);
    } finally { await f.stop(); }
  });
  it("keeps failed note/selection/request for retry after a real committed revalidation failure", async () => {
    const f = await createReclamationFixture({ extraAssignment: false });
    try {
      let failure = true;
      let ids = 0;
      const user = userEvent.setup();
      render(<UsageView model={await model(f, f.ids.companyA)} locale="es-EC" labels={labels} propose={action(f, () => { if (failure) throw new Error("observer failure"); })} requestId={() => { ids++; return f.ids.command1; }} />);
      await user.click(screen.getByTestId(`select_person_${f.ids.person1}`));
      await user.click(screen.getByTestId("btn_propose_reclamation"));
      await user.type(screen.getByTestId("note"), "retry note");
      await user.click(screen.getByTestId("btn_send_proposals"));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(labels.proposal.errors.unexpected));
      expect((screen.getByTestId("note") as HTMLTextAreaElement).value).toBe("retry note");
      expect((screen.getByTestId(`select_person_${f.ids.person1}`) as HTMLInputElement).checked).toBe(true);
      failure = false;
      await user.click(screen.getByTestId("btn_send_proposals"));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain(labels.proposal.success.replace("{created}", "0").replace("{existing}", "1")));
      expect(ids).toBe(1);
      expect(await f.database.select().from(reclamationProposal)).toHaveLength(1);
      const audits = await f.database.select().from(auditLog).where(eq(auditLog.action, "reclamation.proposed"));
      expect(audits).toHaveLength(1);
      expect(audits[0].companyId).toBe(f.ids.companyA);
    } finally { await f.stop(); }
  });
  it("synchronizes duplicate person rows, traps focus and isolates/reset stores by scope", async () => {
    const f = await createReclamationFixture();
    try {
      const user = userEvent.setup();
      await f.ownerDb.update(licenseAssignment).set({ sourceRequestId: null }).where(eq(licenseAssignment.id, f.ids.assignmentExtra));
      await f.ownerDb.insert(activityRecord).values([
        { personId: f.ids.person1, vendorAccountId: f.ids.account, activityDate: "2026-10-07", counters: { chat_metrics: { message_count: 1 } }, syncedAt: f.now(), source: "manual" },
        { personId: f.ids.outsider, vendorAccountId: f.ids.account, activityDate: "2026-09-01", counters: { chat_metrics: { message_count: 1 } }, syncedAt: f.now(), source: "manual" },
      ]);
      const all = await model(f);
      const view = render(<UsageView model={all} locale="es-EC" labels={labels} propose={action(f)} requestId={() => f.ids.command1} />);
      const checks = screen.getAllByTestId(`select_person_${f.ids.person1}`) as HTMLInputElement[];
      expect(checks).toHaveLength(2);
      expect(all.rows.find(r => r.assignmentId === f.ids.assignmentExtra)).toMatchObject({ classification: "active", anchorState: null });
      expect(all.rows.find(r => r.personId === f.ids.outsider)).toMatchObject({ classification: "inactive", anchorState: null });
      expect((screen.getByTestId(`select_person_${f.ids.outsider}`) as HTMLInputElement).disabled).toBe(false);
      await user.click(checks[0]);
      expect(checks.every(c => c.checked)).toBe(true);
      await user.click(screen.getByTestId("btn_propose_reclamation"));
      const note = screen.getByTestId("note");
      await user.keyboard("{Shift>}{Tab}{/Shift}");
      expect(document.activeElement).toBe(screen.getByTestId("btn_send_proposals"));
      await user.keyboard("{Tab}"); expect(document.activeElement).toBe(note);
      await user.keyboard("{Escape}"); expect(screen.queryByRole("dialog")).toBeNull();
      view.rerender(<UsageView model={{ ...all, filters: { window: 60 } }} locale="es-EC" labels={labels} propose={action(f)} requestId={() => f.ids.command1} />);
      expect((screen.getAllByTestId(`select_person_${f.ids.person1}`)[0] as HTMLInputElement).checked).toBe(false);
      view.rerender(<UsageView model={{ ...all, filters: { window: 60, cursor: "other-page" } }} locale="es-EC" labels={labels} propose={action(f)} requestId={() => f.ids.command1} />);
      expect((screen.getByTestId("btn_propose_reclamation") as HTMLButtonElement).disabled).toBe(true);
      render(<UsageView model={all} locale="es-EC" labels={labels} propose={action(f)} requestId={() => f.ids.command2} />);
      const tables = screen.getAllByTestId("usage_table");
      await user.click(within(tables[1]).getAllByTestId(`select_person_${f.ids.person1}`)[0]);
      expect((within(tables[0]).getAllByTestId(`select_person_${f.ids.person1}`)[0] as HTMLInputElement).checked).toBe(false);
      expect((within(tables[1]).getAllByTestId(`select_person_${f.ids.person1}`)[0] as HTMLInputElement).checked).toBe(true);
    } finally { await f.stop(); }
  });
  it("freezes pending controls against duplicate send/cancel and ignores a stale scope result", async () => {
    const f = await createReclamationFixture({ extraAssignment: false });
    let blocker: Awaited<ReturnType<typeof f.fixture.connectAsOwner>> | undefined;
    try {
      const user = userEvent.setup();
      const all = await model(f);
      const view = render(<UsageView model={all} locale="es-EC" labels={labels} propose={action(f)} requestId={() => f.ids.command1} />);
      await user.click(screen.getByTestId(`select_person_${f.ids.person1}`));
      await user.click(screen.getByTestId("btn_propose_reclamation"));
      blocker = await f.fixture.connectAsOwner();
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM license_assignment WHERE id=$1 FOR UPDATE", [f.ids.assignment1]);
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await user.dblClick(screen.getByTestId("btn_send_proposals"));
      await waitFor(async () => expect((await blocker!.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))", [pid])).rows.length).toBe(1));
      expect((screen.getByTestId("note") as HTMLTextAreaElement).disabled).toBe(true);
      expect((screen.getByTestId("btn_send_proposals") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: labels.proposal.cancel }) as HTMLButtonElement).disabled).toBe(true);
      await user.keyboard("{Escape}"); expect(screen.getByRole("dialog")).toBeTruthy();
      fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true })); expect(screen.getByRole("dialog")).toBeTruthy();
      view.rerender(<UsageView model={{ ...all, filters: { window: 60, companyId: f.ids.companyB } }} locale="es-EC" labels={labels} propose={action(f)} requestId={() => f.ids.command2} />);
      await blocker.query("COMMIT");
      await waitFor(async () => expect(await f.database.select().from(reclamationProposal)).toHaveLength(1));
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect((screen.getByTestId("btn_propose_reclamation") as HTMLButtonElement).disabled).toBe(true);
      expect(await f.database.select().from(auditLog).where(eq(auditLog.action, "reclamation.proposed"))).toHaveLength(1);
    } finally { await blocker?.query("ROLLBACK"); await blocker?.end(); await f.stop(); }
  });
});
