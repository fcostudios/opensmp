import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertList, type AlertListLabels } from "./alert-list";

const labels: AlertListLabels = {
  acknowledgedAt: "Acknowledged at",
  acknowledgedBy: "Acknowledged by",
  all: "All",
  emptyAll: "No alerts have fired.",
  emptyUnacknowledged: "No alerts need review.",
  firedAt: "Fired",
  notified: "Notification",
  scope: "Scope",
  subject: "Subject",
  type: "Type",
  unacknowledged: "Unacknowledged",
};

const items = [
  {
    acknowledgedAt: null,
    acknowledgedBy: null,
    firedAt: "2026-07-29T14:00:00.000Z",
    href: "/solicitudes/request-new",
    id: "new",
    notified: "Sent",
    scope: "Company A",
    subject: "request-new",
    type: "Approval aging",
  },
  {
    acknowledgedAt: "2026-07-29T13:30:00.000Z",
    acknowledgedBy: "admin@example.test",
    firedAt: "2026-07-29T13:00:00.000Z",
    href: null,
    id: "old",
    notified: "Pending",
    scope: "Company A",
    subject: "Malformed subject",
    type: "Low pool",
  },
] as const;

describe("AlertList", () => {
  it("defaults to the unacknowledged projection and links only safe subjects", () => {
    const html = renderToStaticMarkup(
      <AlertList
        activeFilter="unacknowledged"
        allCount="2"
        allHref="?filter=all"
        items={items.filter((item) => item.acknowledgedAt === null)}
        labels={labels}
        locale="en-US"
        unacknowledgedCount="1"
        unacknowledgedHref="?filter=unacknowledged"
      />,
    );

    expect(html).toContain('data-testid="tab-sin-reconocer"');
    expect(html).toContain("Unacknowledged <span");
    expect(html).toContain("All <span");
    expect(html).toMatch(
      /aria-current="page"[^>]*data-testid="tab-sin-reconocer"/,
    );
    expect(html).not.toMatch(/aria-current="page"[^>]*data-testid="tab-todas"/);
    expect(html).toContain('href="/solicitudes/request-new"');
    expect(html).not.toContain("admin@example.test");
    expect(html).not.toContain(labels.emptyAll);
    expect(html).not.toContain(labels.emptyUnacknowledged);
  });

  it("renders acknowledged metadata in the all projection without inventing a link", () => {
    const html = renderToStaticMarkup(
      <AlertList
        activeFilter="all"
        allCount="2"
        allHref="?filter=all"
        items={items}
        labels={labels}
        locale="en-US"
        unacknowledgedCount="1"
        unacknowledgedHref="?filter=unacknowledged"
      />,
    );

    expect(html).toContain('data-testid="alerts_table"');
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="tab-todas"/);
    expect(html).not.toMatch(
      /aria-current="page"[^>]*data-testid="tab-sin-reconocer"/,
    );
    expect(html).toContain("admin@example.test");
    expect(html).toContain("Jul 29, 2026");
    expect(html).not.toContain('href="null"');
    expect(html).not.toContain(labels.emptyAll);
    expect(html).not.toContain(labels.emptyUnacknowledged);
  });

  it.each([
    ["all", "No alerts have fired.", "No alerts need review."],
    ["unacknowledged", "No alerts need review.", "No alerts have fired."],
  ] as const)("renders the honest %s empty projection", (activeFilter, expected, absent) => {
    const html = renderToStaticMarkup(
      <AlertList
        activeFilter={activeFilter}
        allCount="0"
        allHref="?filter=all"
        items={[]}
        labels={labels}
        locale="en-US"
        unacknowledgedCount="0"
        unacknowledgedHref="?filter=unacknowledged"
      />,
    );

    expect(html).toContain(expected);
    expect(html).not.toContain(absent);
  });

  it("renders a row action only for unacknowledged rows", () => {
    const html = renderToStaticMarkup(
      <AlertList
        activeFilter="all"
        allCount="2"
        allHref="?filter=all"
        items={[
          {
            acknowledgedAt: null,
            acknowledgedBy: null,
            firedAt: "2026-07-29T14:00:00.000Z",
            href: "/solicitudes/request-new",
            id: "open",
            notified: "Sent",
            scope: "Company A",
            subject: "request-new",
            type: "Approval aging",
          },
          {
            acknowledgedAt: "2026-07-29T13:30:00.000Z",
            acknowledgedBy: "admin@example.test",
            firedAt: "2026-07-29T13:00:00.000Z",
            href: null,
            id: "closed",
            notified: "Pending",
            scope: "Company A",
            subject: "Malformed subject",
            type: "Low pool",
          },
        ]}
        labels={labels}
        locale="en-US"
        renderRowAction={(item) => (
          <button data-testid={`ack-${item.id}`} />
        )}
        unacknowledgedCount="1"
        unacknowledgedHref="?filter=unacknowledged"
      />,
    );

    expect(html).toContain('data-testid="ack-open"');
    expect(html).not.toContain('data-testid="ack-closed"');
  });
});
