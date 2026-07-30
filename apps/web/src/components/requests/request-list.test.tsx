import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  filterRequestList,
  RequestList,
  type RequestListLabels,
} from "./request-list";

const labels: RequestListLabels = {
  allStates: "Todas",
  company: "Organización",
  decided: "Decidida",
  emptyDescription: "Empieza con Solicitar licencia.",
  emptyTitle: "Todavía no has pedido ninguna licencia",
  filters: "Filtrar",
  from: "Desde",
  licenseRequest: "Solicitud",
  neededBy: "Necesaria para",
  newRequest: "Solicitar licencia",
  state: "Estado",
  submitted: "Enviada",
  tableTitle: "Solicitudes",
  to: "Hasta",
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

describe("RequestList", () => {
  test("intersects state and inclusive submitted date filters", () => {
    const base = {
      companyName: "Acme",
      decidedAt: null,
      licenseTypeName: "Claude Enterprise",
      neededBy: null,
      personName: "Employee",
      requestNo: "SOL-1301",
      vendorAccountName: "Claude Org",
    } as const;
    expect(
      filterRequestList(
        [
          {
            ...base,
            id: "one",
            state: "active",
            submittedAt: "2026-07-25T23:00:00.000Z",
          },
          {
            ...base,
            id: "two",
            state: "failed",
            submittedAt: "2026-07-26T00:00:00.000Z",
          },
        ],
        { from: "2026-07-25", state: "active", to: "2026-07-25" },
      ).map(({ id }) => id),
    ).toEqual(["one"]);
    const items = [
      {
        ...base,
        id: "before",
        state: "active" as const,
        submittedAt: "2026-07-24T23:59:59.000Z",
      },
      {
        ...base,
        id: "match",
        state: "active" as const,
        submittedAt: "2026-07-25T05:00:00.000Z",
      },
      {
        ...base,
        id: "wrong-state",
        state: "failed" as const,
        submittedAt: "2026-07-25T12:00:00.000Z",
      },
      {
        ...base,
        id: "after",
        state: "active" as const,
        submittedAt: "2026-07-26T05:00:00.000Z",
      },
    ];
    expect(
      filterRequestList(items, {
        from: "2026-07-25",
        state: "active",
        to: "2026-07-25",
      }).map(({ id }) => id),
    ).toEqual(["match"]);
    expect(
      filterRequestList(items, { from: "", state: "", to: "" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["before", "match", "wrong-state", "after"]);
    expect(
      filterRequestList(
        [
          {
            ...base,
            id: "utc-boundary",
            state: "active",
            submittedAt: "2026-07-25T01:00:00.000Z",
          },
        ],
        { from: "2026-07-24", state: "", to: "2026-07-24" },
      ).map(({ id }) => id),
    ).toEqual(["utc-boundary"]);
  });

  test("renders TOON filters, all state options, and scoped deep links", () => {
    const html = renderToStaticMarkup(
      <RequestList
        filters={{ from: "", state: "", to: "" }}
        items={[
          {
            companyName: "Acme",
            decidedAt: null,
            id: "13000000-0000-0000-0000-000000000014",
            licenseTypeName: "Claude Enterprise",
            neededBy: "2026-08-05",
            personName: "Employee",
            requestNo: "SOL-1301",
            state: "pending_approval",
            submittedAt: "2026-07-25T12:00:00.000Z",
            vendorAccountName: "Claude Org",
          },
        ]}
        labels={labels}
        locale="es-EC"
        statusLabels={statusLabels}
      />,
    );
    expect(html).toContain('data-testid="requests_actions"');
    expect(html).toContain('data-testid="requests_filters"');
    expect(html).toContain('data-testid="filter_fecha"');
    expect(html).toContain('data-testid="filter_estado"');
    expect(html.match(/<option/g)?.length).toBe(13);
    expect(html).toContain('data-testid="requests_table"');
    expect(html).toContain(
      'href="/solicitudes/13000000-0000-0000-0000-000000000014"',
    );
  });

  test("renders the specified empty state and CTA", () => {
    const html = renderToStaticMarkup(
      <RequestList
        filters={{ from: "", state: "", to: "" }}
        items={[]}
        labels={labels}
        locale="en-US"
        statusLabels={statusLabels}
      />,
    );
    expect(html).toContain('data-testid="requests_empty"');
    expect(html).toContain(labels.emptyTitle);
    expect(html).toContain('data-testid="btn_empty_new_request"');
  });
});
