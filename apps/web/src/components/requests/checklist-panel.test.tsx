// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChecklistPanel } from "./checklist-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => {
    throw new Error("ChecklistPanel must not own client projection invalidation");
  },
}));

const action = {
  id: "32000000-0000-4000-8000-000000000009",
  rawRequest: {
    checklistSteps: [{
      messageKey: "connector.manual.invite_person",
      params: {
        licenseTypeName: "Generic seat",
        personEmail: "person@example.com",
      },
      targets: {
        requestId: "32000000-0000-4000-8000-000000000008",
        vendorAccountId: "32000000-0000-4000-8000-000000000006",
        personId: "32000000-0000-4000-8000-000000000004",
        licenseId: "32000000-0000-4000-8000-000000000007",
      },
    }],
    context: {},
    instruction: {
      requestId: "32000000-0000-4000-8000-000000000008",
      vendorAccountId: "32000000-0000-4000-8000-000000000006",
      personEmail: "person@example.com",
      licenseTypeName: "Generic seat",
    },
    operation: "provision",
    protocol: "none",
    version: 1,
  },
  status: "pending" as const,
};

const labels = {
  cancel: "Cancelar",
  confirm: "Confirmar ejecución",
  confirmBody: "La sincronización verificará el cambio.",
  confirmTitle: "¿Confirmas que ejecutaste todos los pasos?",
  failure: "Marcar no completada",
  failureError: "Debes indicar el motivo.",
  failureLabel: "Motivo",
  failureTitle: "Marca la ejecución como no completada",
  genericError: "No se pudo guardar.",
  step: {
    "connector.manual.invite_person": "Invita a {personEmail} y asigna {licenseTypeName}",
  },
  submitting: "Guardando…",
  title: "Lista de pasos pendiente (modo orquestación)",
};

afterEach(() => {
  cleanup();
});

describe("SCR-request-detail orchestration checklist", () => {
  it("keeps successful projection invalidation in the server action only", () => {
    const panelSource = readFileSync(
      resolve(import.meta.dirname, "checklist-panel.tsx"),
      "utf8",
    );
    const actionSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../../modules/request-workflow/actions/checklist.ts",
      ),
      "utf8",
    );

    expect(panelSource).not.toContain("useRouter");
    expect(panelSource).not.toContain("router.refresh");
    expect(panelSource).not.toContain("useTransition");
    expect(panelSource).not.toContain("startTransition");
    expect(panelSource).toContain("useActionState");
    expect(panelSource).toContain("<form action={confirmFormAction}>");
    expect(panelSource).toContain("<form action={failureFormAction}>");
    expect(actionSource).toContain(
      'import { redirect } from "next/navigation"',
    );
    expect(actionSource).not.toContain("refresh");
    expect(actionSource).not.toContain("revalidatePath");
    expect(actionSource).not.toContain("referrer");
    expect(actionSource).not.toContain("redirectTo");
    expect(actionSource).toContain(
      "if (result.ok) redirect(`/solicitudes/${result.requestId}?tab=assignment`)",
    );
    expect(actionSource).toContain(
      "if (result.ok) redirect(`/solicitudes/${result.requestId}?tab=actions`)",
    );
  });

  it("renders only a validated checklist payload", () => {
    const { rerender } = render(
      <ChecklistPanel
        action={action}
        confirmAction={async () => ({ ok: true })}
        labels={labels}
        notDoneAction={async () => ({ ok: true })}
      />,
    );
    expect(screen.getByTestId("checklist_pending").textContent).toContain(
      "Invita a person@example.com y asigna Generic seat",
    );

    rerender(
      <ChecklistPanel
        action={{ ...action, rawRequest: { checklistSteps: ["unsafe"] } }}
        confirmAction={async () => ({ ok: true })}
        labels={labels}
        notDoneAction={async () => ({ ok: true })}
      />,
    );
    expect(screen.queryByTestId("checklist_pending")).toBeNull();
  });

  it("closes and settles a successful confirmation without client navigation", async () => {
    const user = userEvent.setup();
    let confirmed = 0;
    render(
      <ChecklistPanel
        action={action}
        confirmAction={async () => {
          confirmed += 1;
          return { ok: true };
        }}
        labels={labels}
        notDoneAction={async () => ({ ok: true })}
      />,
    );

    await user.click(screen.getByTestId("btn_confirm_checklist"));
    const confirmDialog = screen.getByRole("dialog");
    expect(confirmDialog.hasAttribute("open")).toBe(true);
    await user.click(
      within(confirmDialog).getByRole("button", {
        name: "Confirmar ejecución",
      }),
    );
    expect(confirmed).toBe(1);
    await waitFor(() => {
      expect(confirmDialog.hasAttribute("open")).toBe(false);
      expect(document.activeElement).toBe(
        screen.getByTestId("btn_confirm_checklist"),
      );
    });
    expect(screen.queryByText(labels.genericError)).toBeNull();
    expect(screen.getByTestId("checklist_pending")).not.toBeNull();
    expect(
      (screen.getByTestId("btn_confirm_checklist") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("requires a reason and settles a successful failure without client navigation", async () => {
    const user = userEvent.setup();
    const reasons: string[] = [];
    render(
      <ChecklistPanel
        action={action}
        confirmAction={async () => ({ ok: true })}
        labels={labels}
        notDoneAction={async ({ reason }) => {
          reasons.push(reason);
          return { ok: true };
        }}
      />,
    );
    await user.click(screen.getByTestId("btn_checklist_not_done"));
    const failureDialog = screen.getByRole("dialog");
    const submit = within(failureDialog).getByRole("button", {
      name: "Marcar no completada",
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(failureDialog.querySelector("form")!);
    expect((await screen.findByRole("alert")).textContent).toBe(
      labels.failureError,
    );
    await user.type(screen.getByLabelText("Motivo"), "  Console sin acceso  ");
    await user.click(submit);
    expect(reasons).toEqual(["Console sin acceso"]);
    await waitFor(() => {
      expect(failureDialog.hasAttribute("open")).toBe(false);
      expect(document.activeElement).toBe(
        screen.getByTestId("btn_checklist_not_done"),
      );
    });
    expect(screen.queryByText(labels.genericError)).toBeNull();
    expect(screen.getByTestId("checklist_pending")).not.toBeNull();
    expect(
      (screen.getByTestId("btn_checklist_not_done") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps error dialogs open for rejected projections", async () => {
    const user = userEvent.setup();
    render(
      <ChecklistPanel
        action={action}
        confirmAction={async () => ({ ok: false, error: "conflict" })}
        labels={labels}
        notDoneAction={async () => ({ ok: false, error: "forbidden" })}
      />,
    );

    await user.click(screen.getByTestId("btn_confirm_checklist"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirmar ejecución",
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe("No se pudo guardar.");
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancelar",
      }),
    );
    await user.click(screen.getByTestId("btn_checklist_not_done"));
    await user.type(screen.getByLabelText("Motivo"), "Sin acceso");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Marcar no completada",
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe("No se pudo guardar.");
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
  });

  it("disables controls only while a rejected action promise is in flight", async () => {
    let settle:
      | ((result: { readonly ok: false; readonly error: "conflict" }) => void)
      | undefined;
    const result = new Promise<{
      readonly ok: false;
      readonly error: "conflict";
    }>((resolveResult) => {
      settle = resolveResult;
    });
    const user = userEvent.setup();
    render(
      <ChecklistPanel
        action={action}
        confirmAction={() => result}
        labels={labels}
        notDoneAction={async () => ({ ok: true })}
      />,
    );

    await user.click(screen.getByTestId("btn_confirm_checklist"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirmar ejecución",
      }),
    );
    expect(
      (screen.getByTestId("btn_confirm_checklist") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("btn_checklist_not_done") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    settle?.({ ok: false, error: "conflict" });
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(
      (screen.getByTestId("btn_confirm_checklist") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("btn_checklist_not_done") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
