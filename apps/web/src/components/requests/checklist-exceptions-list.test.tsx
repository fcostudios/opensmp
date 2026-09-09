// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { normalizeIntlWhitespace } from "@/test-support/intl";
import { ChecklistExceptionsList } from "./checklist-exceptions-list";

afterEach(cleanup);

const labels = {
  action: "Acción",
  failureAssignmentMissing:
    "La sincronización de miembros no encontró la asignación activa atestada.",
  empty: "No hay acciones fallidas.",
  kindChecklist: "Lista",
  kindInvite: "Invitación",
  mode: "Modo",
  modeAutomated: "Automatizada",
  modeOrchestration: "Orquestación",
  noData: "No disponible",
  organization: "Organización",
  reason: "Motivo",
  retryProvisioning: "Reintentar aprovisionamiento",
  retryUnavailable: "Disponible en Sprint 3",
  request: "Solicitud",
  sentAt: "Enviada",
  status: "Estado",
  statusFailed: "Fallida",
  statusVerificationFailed: "Verificación fallida",
  viewRequest: "Abrir solicitud",
  vendorReference: "Referencia",
};

it("renders failed and verification-failed action evidence with TOON ids and safe request links", () => {
  render(
    <ChecklistExceptionsList
      failures={[
        {
          actionId: "32000000-0000-4000-8000-000000000009",
          companyName: "Compañía A",
          failureReason: "La consola rechazó la invitación.",
          kind: "checklist",
          mode: "orchestration",
          personEmail: "persona@example.com",
          requestId: "32000000-0000-4000-8000-000000000008",
          requestNo: "REQ-1",
          sentAt: "2026-07-18T12:00:00.000Z",
          status: "failed",
          vendorAccountName: "Organización A",
          vendorRef: "inv_9f27",
        },
        {
          actionId: "32000000-0000-4000-8000-000000000019",
          companyName: "Compañía B",
          failureReason:
            "checklist_assignment_missing|No matching assignment row for observation member-sync-7.",
          kind: "checklist",
          mode: "orchestration",
          personEmail: "otra@example.com",
          requestId: "32000000-0000-4000-8000-000000000018",
          requestNo: "REQ-2",
          sentAt: null,
          status: "verification_failed",
          vendorAccountName: "Organización B",
          vendorRef: null,
        },
        {
          actionId: "32000000-0000-4000-8000-000000000029",
          companyName: "Compañía A",
          failureReason: "provider_invitation_failed",
          kind: "invite",
          mode: "automated",
          personEmail: "tercera@example.com",
          requestId: "32000000-0000-4000-8000-000000000028",
          requestNo: "REQ-3",
          sentAt: null,
          status: "failed",
          vendorAccountName: "Organización A",
          vendorRef: null,
        },
      ]}
      labels={labels}
      retryAction={async () => undefined}
    />,
  );

  const table = screen.getByTestId("table_failed");
  expect(
    within(table).getByTestId(
      "motivo-32000000-0000-4000-8000-000000000009",
    ).textContent,
  ).toBe("La consola rechazó la invitación.");
  expect(
    within(table).getByTestId(
      "estado-32000000-0000-4000-8000-000000000009",
    ).textContent,
  ).toBe("Fallida");
  expect(
    within(table).getByTestId(
      "estado-32000000-0000-4000-8000-000000000019",
    ).textContent,
  ).toBe("Verificación fallida");
  expect(
    within(table).getByTestId(
      "motivo-32000000-0000-4000-8000-000000000019",
    ).textContent,
  ).toBe(
    "La sincronización de miembros no encontró la asignación activa atestada.",
  );
  expect(
    within(table)
      .getByRole("link", { name: "REQ-1 · persona@example.com" })
      .getAttribute("href"),
  ).toBe("/solicitudes/32000000-0000-4000-8000-000000000008");
  expect(within(table).getAllByText("Lista")).toHaveLength(2);
  expect(within(table).getAllByText("Orquestación")).toHaveLength(2);
  expect(within(table).getByText("Invitación")).toBeTruthy();
  expect(within(table).getByText("Automatizada")).toBeTruthy();
  expect(
    within(table).getByText("32000000-0000-4000-8000-000000000009"),
  ).toBeTruthy();
  expect(within(table).getByTestId("vendor_ref").textContent).toBe("Referencia");
  expect(within(table).getByTestId("enviada").textContent).toBe("Enviada");
  expect(within(table).getByText("inv_9f27")).toBeTruthy();
  const sentAt = table.querySelector("time");
  expect(sentAt?.getAttribute("datetime")).toBe("2026-07-18T12:00:00.000Z");
  expect(normalizeIntlWhitespace(sentAt?.textContent ?? "")).toBe(
    normalizeIntlWhitespace(
      new Intl.DateTimeFormat("es-EC", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date("2026-07-18T12:00:00.000Z")),
    ),
  );
  expect(within(table).getAllByText("Disponible en Sprint 3")).toHaveLength(2);
  const retry = screen.getByTestId(
    "btn_retry_provisioning-32000000-0000-4000-8000-000000000029",
  );
  expect(retry).toHaveProperty("disabled", false);
  expect(
    retry.closest("form")?.querySelector<HTMLInputElement>('input[name="actionId"]')?.value,
  ).toBe("32000000-0000-4000-8000-000000000029");
  expect(screen.queryByRole("link", { name: "Reintentar aprovisionamiento" })).toBeNull();
});

it("does not turn a non-UUID request trace into a link", () => {
  render(
    <ChecklistExceptionsList
      failures={[
        {
          actionId: "32000000-0000-4000-8000-000000000009",
          companyName: "Compañía A",
          failureReason: "Fallo.",
          kind: "checklist",
          mode: "orchestration",
          personEmail: "persona@example.com",
          requestId: "../../credenciales",
          requestNo: "REQ-X",
          sentAt: null,
          status: "failed",
          vendorAccountName: "Organización A",
          vendorRef: null,
        },
      ]}
      labels={labels}
    />,
  );

  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("REQ-X · persona@example.com")).toBeTruthy();
});

it("does not render a retry action without an eligible failed invitation", () => {
  render(<ChecklistExceptionsList failures={[]} labels={labels} />);

  expect(screen.getByTestId("table_failed").textContent).toContain(
    "No hay acciones fallidas.",
  );
  expect(screen.queryByRole("button", { name: "Reintentar aprovisionamiento" })).toBeNull();
});
