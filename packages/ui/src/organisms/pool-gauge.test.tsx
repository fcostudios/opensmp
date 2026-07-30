import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PoolGauge } from "./pool-gauge";

const labels = {
  assigned: "Assigned",
  available: "Available",
  discrepancy: "Oversubscribed by",
  pending: "Pending invites",
  purchased: "Purchased",
};

describe("PoolGauge", () => {
  it("renders every pool term and announces the low-pool state", () => {
    const markup = renderToStaticMarkup(
      <PoolGauge
        assigned={7}
        free={1}
        labels={labels}
        lowPoolFloor={2}
        pendingInvites={2}
        purchased={10}
      />,
    );

    expect(markup).toContain('data-pool-state="attention"');
    expect(markup).toContain('aria-label="Purchased 10; Assigned 7; Pending invites 2; Available 1"');
    expect(markup).toContain(">Purchased<");
    expect(markup).toContain(">10<");
    expect(markup).toContain(">Available<");
    expect(markup).toContain(">1<");
    expect(markup).toContain('style="width:70%"');
    expect(markup).toContain('style="width:20%"');
    expect(markup).toContain('style="width:10%"');
    expect(markup).not.toContain("Oversubscribed by");
  });

  it("preserves and labels negative free capacity", () => {
    const markup = renderToStaticMarkup(
      <PoolGauge
        assigned={9}
        free={-2}
        labels={labels}
        lowPoolFloor={0}
        pendingInvites={3}
        purchased={10}
      />,
    );

    expect(markup).toContain("Oversubscribed by 2");
    expect(markup).toContain('data-pool-state="discrepancy"');
    expect(markup).toContain('style="width:75%"');
    expect(markup).toContain('style="width:25%"');
    expect(markup).toContain('style="width:0%"');
  });

  it("treats zero free at a zero floor as healthy and renders no discrepancy", () => {
    const markup = renderToStaticMarkup(
      <PoolGauge
        assigned={0}
        free={0}
        labels={labels}
        lowPoolFloor={0}
        pendingInvites={0}
        purchased={0}
      />,
    );

    expect(markup).toContain('data-pool-state="ok"');
    expect(markup).toContain('style="width:0%"');
    expect(markup.match(/style="width:0%"/g)).toHaveLength(3);
    expect(markup).not.toContain("Oversubscribed by");
    expect(markup).toContain(">Assigned<");
    expect(markup).toContain(">Pending invites<");
  });
});
