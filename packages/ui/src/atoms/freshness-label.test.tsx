import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { FreshnessLabel } from "./freshness-label";

const now = new Date("2026-07-21T12:00:00.000Z");

describe("FreshnessLabel", () => {
  test("keeps the exact 48-hour boundary neutral and exposes the exact timestamp", () => {
    const syncedAt = new Date("2026-07-19T12:00:00.000Z");
    const markup = renderToStaticMarkup(
      <FreshnessLabel
        syncedAt={syncedAt}
        now={now}
        locale="es-EC"
        prefix="datos al"
        staleLabel="Datos desactualizados"
      />,
    );

    expect(markup).toContain("freshness-label--fresh");
    expect(markup).toContain(`dateTime="${syncedAt.toISOString()}"`);
    expect(markup).toContain("datos al");
  });

  test("marks data stale only when it is more than 48 hours old", () => {
    const syncedAt = new Date("2026-07-19T11:59:59.999Z");
    const markup = renderToStaticMarkup(
      <FreshnessLabel
        syncedAt={syncedAt}
        now={now}
        locale="en-US"
        prefix="data as of"
        staleLabel="Stale data"
      />,
    );

    expect(markup).toContain("freshness-label--stale");
    expect(markup).toContain(
      '<span class="freshness-label__stale-marker">Stale data: </span>',
    );
    expect(markup).not.toContain('class="sr-only"');
  });
});
