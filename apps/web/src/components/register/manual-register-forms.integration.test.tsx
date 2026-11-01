// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { licenseAssignment } from "@smp/db/schema";
import { createReclamationFixture } from "@/modules/usage/testing/reclamation-fixture";
import { createManualRegisterService } from "@/modules/register/manual-entry-transaction";
import { loadManualRegisterChoices, createRegisterRepository } from "@/modules/register/repository";
import messages from "../../../messages/en-US.json";
import { ManualRegisterForms } from "./manual-register-forms";

test("manual forms persist, close and reject duplicate assignments through the real audited database service", async () => {
  const f = await createReclamationFixture();
  try {
    const service = createManualRegisterService(f.database);
    const choices = await loadManualRegisterChoices(f.admin, f.database);
    const recordAction = (input: unknown) => service.record(f.admin, input, f.now());
    const closeAction = (input: unknown) => service.close(f.admin, input, f.now());
    const view = (assignments: Awaited<ReturnType<ReturnType<typeof createRegisterRepository>["listRows"]>>["items"]) =>
      <NextIntlClientProvider locale="en-US" messages={messages}><ManualRegisterForms choices={choices} assignments={assignments} recordAction={recordAction} closeAction={closeAction} /></NextIntlClientProvider>;
    const rendered = render(view([]));
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: f.ids.noOpen } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getAllByLabelText("Note")[0]!, { target: { value: "Pilot roster" } });
    fireEvent.click(screen.getByRole("button", { name: "Record assignment" }));
    const saving = screen.getAllByRole("button", { name: messages.register.manualPending });
    expect(saving).toHaveLength(2);
    expect(saving.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Register updated."));
    const [assignment] = await f.database.select().from(licenseAssignment).where(eq(licenseAssignment.personId, f.ids.noOpen));
    expect(assignment).toMatchObject({ sourceKind: "manual", startedOn: "2026-10-01", companyId: f.ids.companyA, note: "Pilot roster" });
    const rows = await createRegisterRepository(f.database).listRows(f.admin, {});
    rendered.rerender(view(rows.items));
    const options = screen.getByLabelText("Open manual assignment (current page)").querySelectorAll("option");
    expect(Array.from(options).map((item) => item.value)).toEqual([assignment!.id]);
    expect((screen.getByRole("button", { name: "Close assignment" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getAllByLabelText("Note")[1]!, { target: { value: "Departure" } });
    fireEvent.click(screen.getByRole("button", { name: "Close assignment" }));
    await waitFor(async () => {
      expect((await f.database.select().from(licenseAssignment).where(eq(licenseAssignment.id, assignment!.id)))[0]?.endedOn).toBe("2026-10-31");
    });
    const closedRows = await createRegisterRepository(f.database).listRows(f.admin, {});
    rendered.rerender(view(closedRows.items));
    expect((screen.getByRole("button", { name: "Close assignment" }) as HTMLButtonElement).disabled).toBe(true);
    // A duplicate overlaps the closed October interval; the UI retains values for correction.
    fireEvent.click(screen.getByRole("button", { name: "Record assignment" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(messages.register.manualError));
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("2026-10-01");
    expect((screen.getByRole("button", { name: "Record assignment" }) as HTMLButtonElement).disabled).toBe(false);
    expect(await f.database.select().from(licenseAssignment).where(eq(licenseAssignment.personId, f.ids.noOpen))).toHaveLength(1);
  } finally { cleanup(); await f.stop(); }
}, 150_000);
