// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { DecideRequestInput } from "@smp/contracts";

import {
  RequestDetailDecisionView,
  type RequestDetailDecisionLabels,
} from "./request-detail-decision";

const labels: RequestDetailDecisionLabels = {
  approve: "Aprobar",
  approveTitle: "Aprobar solicitud",
  cancel: "Cancelar",
  decisionError: "No pudimos registrar la decisión.",
  reject: "Rechazar",
  rejectionComment: "Motivo",
  rejectionDescription: "La persona verá el comentario.",
  rejectionPlaceholder: "Explica el motivo.",
  rejectionRequired: "El comentario es obligatorio.",
  rejectionTitle: "Rechazar solicitud",
  submitting: "Guardando…",
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("RequestDetailDecision", () => {
  test("approves through the existing action and refreshes only after success", async () => {
    const calls: DecideRequestInput[] = [];
    let refreshes = 0;
    const user = userEvent.setup();
    render(
      <RequestDetailDecisionView
        action={async (input) => {
          calls.push(input);
          return { ok: true };
        }}
        labels={labels}
        refresh={() => {
          refreshes += 1;
        }}
        requestId="13000000-0000-0000-0000-000000000014"
      />,
    );

    const opener = screen.getByTestId("btn_aprobar");
    await user.click(opener);
    expect(screen.getByTestId("modal_aprobar").hasAttribute("open")).toBe(true);
    await user.click(screen.getByTestId("btn_confirmar_aprobacion"));

    await waitFor(() => expect(refreshes).toBe(1));
    expect(calls).toEqual([
      {
        decision: "approved",
        requestId: "13000000-0000-0000-0000-000000000014",
      },
    ]);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  test("requires and trims a rejection comment before sending the exact payload", async () => {
    const calls: DecideRequestInput[] = [];
    const user = userEvent.setup();
    render(
      <RequestDetailDecisionView
        action={async (input) => {
          calls.push(input);
          return { ok: true };
        }}
        labels={labels}
        refresh={() => undefined}
        requestId="13000000-0000-0000-0000-000000000014"
      />,
    );

    await user.click(screen.getByTestId("btn_rechazar"));
    const confirm = screen.getByTestId("btn_confirmar_rechazo");
    expect(screen.getByTestId("btn_cancelar_rechazo")).not.toBeNull();
    expect(screen.getByTestId("modal_rechazo").hasAttribute("open")).toBe(true);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByTestId("decision_comment"), "  no budget  ");
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);

    await waitFor(() =>
      expect(calls).toEqual([
        {
          decision: "rejected",
          decisionComment: "no budget",
          requestId: "13000000-0000-0000-0000-000000000014",
        },
      ]),
    );
  });

  test("keeps the modal and visible error without refreshing on conflict", async () => {
    let refreshes = 0;
    const user = userEvent.setup();
    render(
      <RequestDetailDecisionView
        action={async () => ({ ok: false, error: "decision_failed" })}
        labels={labels}
        refresh={() => {
          refreshes += 1;
        }}
        requestId="13000000-0000-0000-0000-000000000014"
      />,
    );

    await user.click(screen.getByTestId("btn_aprobar"));
    fireEvent.click(screen.getByTestId("btn_confirmar_aprobacion"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      labels.decisionError,
    );
    expect(screen.getByTestId("modal_aprobar").hasAttribute("open")).toBe(true);
    expect(refreshes).toBe(0);
  });
});
