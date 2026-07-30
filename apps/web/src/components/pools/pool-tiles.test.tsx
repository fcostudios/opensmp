// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PoolTiles } from "./pool-tiles";

afterEach(cleanup);

describe("US-022 dashboard and vendor-detail pool tiles", () => {
  it("aggregates the canonical pool snapshots into all four SCR tiles", () => {
    const { container } = render(
      <PoolTiles
        idPrefix="kpi"
        labels={{
          assigned: "Assigned",
          free: "Available",
          pending: "Pending",
          purchased: "Purchased",
        }}
        snapshots={[
          { assigned: 7, free: 2, pendingInvites: 2, purchased: 10 },
          { assigned: 3, free: -1, pendingInvites: 1, purchased: 3 },
        ]}
      />,
    );

    expect(screen.getByTestId("kpi_purchased").textContent).toBe("Purchased13");
    expect(screen.getByTestId("kpi_assigned").textContent).toBe("Assigned10");
    expect(screen.getByTestId("kpi_pending").textContent).toBe("Pending3");
    expect(screen.getByTestId("kpi_free").textContent).toBe("Available1");
    expect(container.querySelector("section")?.dataset.section).toBe(
      "kpi_pool_row",
    );
  });

  it("uses the vendor-detail tile contract without inventing actions", () => {
    const { container } = render(
      <PoolTiles
        idPrefix="tile"
        labels={{
          assigned: "Assigned",
          free: "Available",
          pending: "Pending",
          purchased: "Purchased",
        }}
        snapshots={[]}
      />,
    );
    expect(screen.getByTestId("tile_free").textContent).toContain("0");
    expect(container.querySelector("section")?.dataset.section).toBe(
      "capacity_tiles",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
