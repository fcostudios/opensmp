// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import type { RequestRecordProjection } from "@/modules/request-workflow/read-repository";
import { normalizeIntlWhitespace } from "@/test-support/intl";
import {
  formatTimelineDateTime,
  RequestRecord,
  type RequestRecordLabels,
} from "./request-record";

const labels: RequestRecordLabels = {
  actionKind: {
    assign_sku: "Asignar licencia",
    checklist: "Lista",
    invite: "Invitación",
    remove: "Retiro",
    withdraw_invite: "Retirar invitación",
  },
  actionMode: {
    automated: "Automatizado",
    orchestration: "Orquestación",
  },
  actionStatus: {
    confirmed: "Confirmada",
    failed: "Fallida",
    pending: "Pendiente",
    sent: "Enviada",
    verification_failed: "Verificación fallida",
    withdrawn: "Retirada",
  },
  actions: "Acciones",
  actionsEmpty: "No hay acciones.",
  assignment: "Asignación",
  assignmentActive: "Activa",
  assignmentEmpty: "Aún no existe una asignación.",
  assignmentEnded: "Terminada",
  audit: "Auditoría",
  auditEmpty: "No hay eventos.",
  blockedBody: "Te avisaremos cuando exista una licencia.",
  blockedTitle: "Sin licencias disponibles",
  company: "Compañía",
  closePayload: "Cerrar",
  daysInState: "Días en este estado",
  decisionComment: "Comentario de la decisión",
  endedOn: "Terminó",
  failedBody: "Revisa el último intento.",
  failedTitle: "El aprovisionamiento falló",
  failureReason: "Motivo",
  justification: "Justificación",
  kind: "Acción",
  neededBy: "La necesita para",
  noDate: "—",
  noPayloadResponse: "Sin respuesta",
  organization: "Organización",
  rawPayload: "Detalle técnico",
  rawRequest: "Solicitud enviada",
  rawResponse: "Respuesta recibida",
  request: "Solicitud",
  requestedBy: "Pedida por",
  resolvedAt: "Resuelta",
  sentAt: "Enviada",
  startedOn: "Activa desde",
  state: "Estado",
  stateHistory: "Historial de estados",
  systemActor: "Sistema",
  vendorReference: "Referencia del proveedor",
  viewPools: "Ver cupos",
  viewRegister: "Ver en el registro",
};

const statusLabels = {
  active: "Activa",
  approved: "Aprobada",
  blocked_no_seat: "Bloqueada",
  deprovisioned: "Retirada",
  failed: "Fallida",
  flagged_inactive: "Marcada inactiva",
  invited: "Invitación enviada",
  offboarding: "En retiro",
  pending_approval: "Pendiente de aprobación",
  provisioning: "Aprovisionando",
  rejected: "Rechazada",
  submitted: "Enviada",
} as const;

afterEach(cleanup);

const blockedRecord: RequestRecordProjection = {
  actions: [
    {
      createdAt: "2026-07-28T12:00:00.000Z",
      failureReason: "Console rejected invite",
      id: "action-1",
      kind: "checklist",
      mode: "orchestration",
      rawRequest: { checklist_steps: ["Invite"] },
      rawResponse: null,
      resolvedAt: null,
      sentAt: null,
      status: "failed",
      vendorRef: null,
    },
  ],
  assignment: {
    endReason: null,
    endedOn: null,
    id: "assignment-1",
    note: null,
    startedOn: "2026-07-29",
  },
  audit: [
    {
      action: "request.blocked_no_seat",
      actor: null,
      entityType: "LicenseRequest",
      id: "audit-1",
      note: "No seats",
      occurredAt: "2026-07-28T12:00:00.000Z",
    },
  ],
  company: { code: "ACM", id: "company-1", name: "Acme" },
  createdAt: "2026-07-25T12:00:00.000Z",
  decidedAt: "2026-07-27T12:00:00.000Z",
  decidedBy: "Ana Approver",
  decisionComment: "Approved",
  id: "request-1",
  justification: "Research",
  licenseType: { id: "license-1", name: "Claude Enterprise" },
  neededBy: "2026-08-05",
  person: {
    email: "employee@acme.test",
    fullName: "Employee",
    id: "person-1",
  },
  requestNo: "SOL-1301",
  requestedBy: "Employee",
  state: "blocked_no_seat",
  stateAgeDays: 2,
  timeline: [
    {
      actor: "Employee",
      from: null,
      id: "transition-1",
      note: "Submitted",
      occurredAt: "2026-07-25T12:00:00.000Z",
      to: "submitted",
    },
  ],
  updatedAt: "2026-07-28T12:00:00.000Z",
  vendorAccount: { id: "vendor-account-1", name: "Claude Org" },
  warnings: [],
};

describe("RequestRecord", () => {
  test("renders the blocked callout, semantic timeline, and group-admin pool action", () => {
    const html = renderToStaticMarkup(
      <RequestRecord
        activeTab="actions"
        isGroupAdmin
        labels={labels}
        locale="es-EC"
        record={blockedRecord}
        statusLabels={statusLabels}
      />,
    );

    expect(html).toContain('data-testid="request_tiles"');
    expect(html).toContain('data-testid="banner_blocked"');
    expect(html).toContain('data-testid="btn_ver_cupos"');
    expect(html).toContain('href="/cupos"');
    expect(html).toContain('data-testid="state_timeline"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('role="tabpanel"');
    expect(html).toContain("Console rejected invite");
    expect(html).toContain("Lista · Orquestación");
    expect(html).toContain(">Fallida<");
    expect(html).not.toContain("checklist · orchestration");
    expect(html).toContain('data-testid="open_payload_action-1"');
    expect(html).not.toContain("checklist_steps");
  });

  test("uses honest navigation links and regions with valid label targets", () => {
    const { container } = render(
      <RequestRecord
        activeTab="assignment"
        isGroupAdmin
        labels={labels}
        locale="es-EC"
        record={blockedRecord}
        statusLabels={statusLabels}
      />,
    );
    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>("[data-testid^='tab_']"),
    );

    expect(links.filter((link) => link.getAttribute("aria-current") === "page"))
      .toHaveLength(1);
    expect(
      container
        .querySelector("[data-testid='tab_asignacion']")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(container.querySelector("[role='tablist']")).toBeNull();
    expect(container.querySelector("[role='tab']")).toBeNull();
    expect(container.querySelector("[role='tabpanel']")).toBeNull();
    for (const region of container.querySelectorAll("[aria-labelledby]")) {
      const labelId = region.getAttribute("aria-labelledby");
      expect(labelId).not.toBeNull();
      expect(container.querySelector(`#${labelId}`)).not.toBeNull();
    }
  });

  test("localizes timeline instants in Ecuador across a UTC date boundary", () => {
    const instant = "2026-07-28T04:30:00.000Z";
    expect(
      normalizeIntlWhitespace(formatTimelineDateTime(instant, "es-EC")),
    ).toBe("27 jul 2026, 11:30 p. m.");
    expect(
      normalizeIntlWhitespace(formatTimelineDateTime(instant, "en-US")),
    ).toBe("Jul 27, 2026, 11:30 PM");
    const html = renderToStaticMarkup(
      <RequestRecord
        activeTab="actions"
        isGroupAdmin={false}
        labels={labels}
        locale="en-US"
        record={{
          ...blockedRecord,
          timeline: [{ ...blockedRecord.timeline[0]!, occurredAt: instant }],
        }}
        statusLabels={statusLabels}
      />,
    );
    expect(html).toContain(`dateTime="${instant}"`);
    expect(html).toContain("Jul 27, 2026, 11:30 PM");
    expect(html).not.toContain(`>${instant}</time>`);
  });

  test("shows assignment and audit only in their documented tabs and role", () => {
    const assignmentHtml = renderToStaticMarkup(
      <RequestRecord
        activeTab="assignment"
        isGroupAdmin
        labels={labels}
        locale="es-EC"
        record={blockedRecord}
        statusLabels={statusLabels}
      />,
    );
    expect(assignmentHtml).toContain('data-testid="asignacion_panel"');
    expect(assignmentHtml).toContain('data-testid="btn_ver_registro"');

    const auditHtml = renderToStaticMarkup(
      <RequestRecord
        activeTab="audit"
        isGroupAdmin
        labels={labels}
        locale="es-EC"
        record={blockedRecord}
        statusLabels={statusLabels}
      />,
    );
    expect(auditHtml).toContain('data-testid="auditoria_table"');
    expect(auditHtml).toContain("request.blocked_no_seat");

    const employeeHtml = renderToStaticMarkup(
      <RequestRecord
        activeTab="audit"
        isGroupAdmin={false}
        labels={labels}
        locale="es-EC"
        record={{ ...blockedRecord, audit: [] }}
        statusLabels={statusLabels}
      />,
    );
    expect(employeeHtml).not.toContain('data-testid="tab_auditoria"');
    expect(employeeHtml).not.toContain('data-testid="auditoria_table"');
  });

  test("renders failed guidance only for failed requests", () => {
    const html = renderToStaticMarkup(
      <RequestRecord
        activeTab="actions"
        isGroupAdmin={false}
        labels={labels}
        locale="en-US"
        record={{
          ...blockedRecord,
          assignment: null,
          audit: [],
          state: "failed",
        }}
        statusLabels={statusLabels}
      />,
    );
    expect(html).toContain('data-testid="banner_failed"');
    expect(html).not.toContain('data-testid="banner_blocked"');
    expect(html).not.toContain('data-testid="btn_ver_cupos"');
    expect(html).not.toContain('data-testid="tab_asignacion"');
    expect(html).not.toContain('data-testid="asignacion_panel"');
  });
});
