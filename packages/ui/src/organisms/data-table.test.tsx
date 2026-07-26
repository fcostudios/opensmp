import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { DataTable, isRowActivationKey } from "./data-table";

describe("DataTable", () => {
  test("renders semantic headers and row values", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Audit events"
        columns={[
          { id: "actor", label: "Actor" },
          { id: "action", label: "Action" },
        ]}
        emptyLabel="No events"
        rows={[
          {
            id: "one",
            cells: {
              action: "created",
              actor: "system",
            },
          },
        ]}
      />,
    );

    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
    expect(html).toContain("system");
    expect(html).toContain("created");
  });

  test("renders one full-width empty cell", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Audit events"
        columns={[{ id: "actor", label: "Actor" }]}
        emptyLabel="No events"
        rows={[]}
      />,
    );

    expect(html).toContain('colSpan="1"');
    expect(html).toContain("No events");
  });

  test("recognizes only keyboard row activation keys", () => {
    expect(isRowActivationKey("Enter")).toBe(true);
    expect(isRowActivationKey(" ")).toBe(true);
    expect(isRowActivationKey("Tab")).toBe(false);
    expect(isRowActivationKey("Escape")).toBe(false);
  });
});
