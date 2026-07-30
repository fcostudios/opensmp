import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { StateTimeline } from "./state-timeline";

describe("StateTimeline", () => {
  test("renders an accessible ordered history with actors and optional notes", () => {
    const html = renderToStaticMarkup(
      <StateTimeline
        items={[
          {
            actor: "Ana Approver",
            from: "Submitted",
            id: "transition-1",
            note: "Ready for review",
            occurredAt: "2026-07-27T15:00:00.000Z",
            occurredAtLabel: "Jul 27, 2026, 10:00 AM",
            to: "Pending approval",
          },
          {
            actor: "Ledger system",
            from: "Pending approval",
            id: "transition-2",
            note: null,
            occurredAt: "2026-07-28T15:00:00.000Z",
            occurredAtLabel: "Jul 28, 2026, 10:00 AM",
            to: "Approved",
          },
        ]}
      />,
    );

    expect(html).toContain("<ol");
    expect(html).toContain("<time");
    expect(html).toContain(
      'dateTime="2026-07-27T15:00:00.000Z">Jul 27, 2026, 10:00 AM',
    );
    expect(html).not.toContain(
      'dateTime="2026-07-27T15:00:00.000Z">2026-07-27T15:00:00.000Z',
    );
    expect(html).toContain("Submitted");
    expect(html).toContain("Pending approval");
    expect(html).toContain("Approved");
    expect(html).toContain("Ana Approver");
    expect(html).toContain("Ready for review");
    expect(html).not.toContain("transition-1");
  });
});
