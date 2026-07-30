import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import enMessages from "../../../messages/en-US.json";
import esMessages from "../../../messages/es-EC.json";
import {
  PersonFreshness,
  assignmentEndReasonLabel,
  assignmentSourceLabel,
  type AssignmentLabelCatalog,
} from "./person-detail-presenters";

const now = new Date("2026-07-27T15:00:00.000Z");

describe("person detail presenters", () => {
  test.each([
    {
      name: "fresh at the exact 48-hour boundary",
      syncedAt: new Date("2026-07-25T15:00:00.000Z"),
      expectedClass: "freshness-label--fresh",
      expectedText: "Sincronizado",
    },
    {
      name: "stale beyond the 48-hour boundary",
      syncedAt: new Date("2026-07-25T14:59:59.999Z"),
      expectedClass: "freshness-label--stale",
      expectedText: "Datos desactualizados",
    },
  ])("renders $name against server render time", ({
    syncedAt,
    expectedClass,
    expectedText,
  }) => {
    const markup = renderToStaticMarkup(
      <PersonFreshness
        locale="es-EC"
        now={now}
        staleLabel="Datos desactualizados"
        syncedAt={syncedAt}
        syncedLabel="Sincronizado"
        unavailableLabel="No disponible"
      />,
    );

    expect(markup).toContain(expectedClass);
    expect(markup).toContain(expectedText);
    expect(markup).toContain(`dateTime="${syncedAt.toISOString()}"`);
  });

  test("renders an explicit unavailable state when no sync exists", () => {
    const markup = renderToStaticMarkup(
      <PersonFreshness
        locale="es-EC"
        now={now}
        staleLabel="Datos desactualizados"
        syncedAt={null}
        syncedLabel="Sincronizado"
        unavailableLabel="No disponible"
      />,
    );

    expect(markup).toContain('data-testid="person_freshness_unavailable"');
    expect(markup).toContain("No disponible");
    expect(markup).not.toContain("<time");
  });

  test("maps every assignment source and nullable end reason through both locale catalogs", () => {
    const es = esMessages.people as AssignmentLabelCatalog;
    const en = enMessages.people as AssignmentLabelCatalog;

    expect(
      (["request", "import", "reconciliation"] as const).map((value) => [
        assignmentSourceLabel(value, es),
        assignmentSourceLabel(value, en),
      ]),
    ).toEqual([
      ["Solicitud", "Request"],
      ["Importación", "Import"],
      ["Conciliación", "Reconciliation"],
    ]);
    expect(
      (["left_company", "inactive", "reallocated", null] as const).map(
        (value) => [
          assignmentEndReasonLabel(value, es),
          assignmentEndReasonLabel(value, en),
        ],
      ),
    ).toEqual([
      ["Salida de la compañía", "Left the company"],
      ["Inactividad", "Inactivity"],
      ["Reasignación", "Reallocation"],
      [null, null],
    ]);
  });
});
