// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { PayloadDialog } from "./payload-dialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("PayloadDialog", () => {
  test("keeps payload out of the DOM until opened and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(
      <PayloadDialog
        actionId="action-1"
        closeLabel="Cerrar"
        label="Detalle técnico"
        noResponseLabel="Sin respuesta"
        rawRequest={{ checklist_steps: ["invite"] }}
        rawRequestLabel="Solicitud enviada"
        rawResponse={null}
        rawResponseLabel="Respuesta recibida"
      />,
    );

    const opener = screen.getByTestId("open_payload_action-1");
    expect(screen.queryByTestId("modal_payload")).toBeNull();
    expect(screen.queryByText(/checklist_steps/)).toBeNull();
    await user.click(opener);
    expect(screen.getByTestId("modal_payload").hasAttribute("open")).toBe(true);
    expect(screen.getByTestId("raw_request").textContent).toContain(
      "checklist_steps",
    );
    expect(screen.getByTestId("raw_request").textContent).toContain(
      "Solicitud enviada",
    );
    expect(screen.getByTestId("raw_response").textContent).toContain(
      "Respuesta recibida",
    );
    expect(screen.getByTestId("raw_response").textContent).toContain(
      "Sin respuesta",
    );
    await user.click(screen.getByTestId("btn_cerrar_payload"));
    expect(screen.queryByTestId("modal_payload")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
