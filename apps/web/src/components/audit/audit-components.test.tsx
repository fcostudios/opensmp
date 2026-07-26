import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { AuditDiffDialog, nextFocusIndex } from "./audit-diff-dialog";
import { AuditFilters } from "./audit-filters";
import { AuditTable } from "./audit-table";
import type { AuditListItem } from "@/modules/audit/types";

const item: AuditListItem = {
  id: "00000000-0000-0000-0000-000000000831",
  actorUserId: null,
  actorEmail: null,
  action: "person.created",
  entityType: "Person",
  entityId: "00000000-0000-0000-0000-000000000832",
  entityHref: "/personas/00000000-0000-0000-0000-000000000832",
  companyId: "00000000-0000-0000-0000-000000000833",
  companyName: "Audit Company",
  companyCode: "AUD",
  note: "Reviewed by operator",
  before: null,
  after: { name: "<script>alert(1)</script>" },
  occurredAt: "2026-07-26T04:30:00.000Z",
};

const labels = {
  action: "Action",
  actor: "Actor",
  added: "Added",
  all: "All",
  after: "After",
  applyFilters: "Apply filters",
  before: "Before",
  close: "Close",
  company: "Company",
  dateFrom: "From",
  dateTo: "To",
  details: "Change details",
  empty: "No audit events",
  entity: "Entity",
  filterAction: "Action",
  filterActor: "Actor",
  filterEntity: "Entity type",
  next: "Next page",
  note: "Note",
  occurredAt: "Date and time",
  removed: "Removed",
  systemActor: "— system",
};

describe("audit screen components", () => {
  test("renders TOON filters as a GET form", () => {
    const html = renderToStaticMarkup(
      <AuditFilters
        actions={["user_account.ui_language.updated"]}
        actors={[]}
        entityTypes={[
          "Authentication",
          "Authorization",
          "user_account",
        ]}
        filters={{}}
        labels={labels}
      />,
    );

    expect(html).toContain('data-testid="audit_filters"');
    expect(html).toContain('name="entityType"');
    expect(html).toContain('name="action"');
    expect(html).toContain('name="actor"');
    expect(html).toContain('name="startDate"');
    expect(html).toContain('name="endDate"');
    expect(html).toContain("user_account.ui_language.updated");
    expect(html).toContain("Authentication");
    expect(html).toContain("Authorization");
    expect(html).toContain("user_account");
  });

  test("renders joined actor company and entity link in the audit table", () => {
    const html = renderToStaticMarkup(
      <AuditTable
        items={[item]}
        labels={labels}
        locale="en-US"
        nextCursor={null}
      />,
    );

    expect(html).toContain('data-testid="table_audit"');
    expect(html).toContain("— system");
    expect(html).toContain("Audit Company (AUD)");
    expect(html).toContain(`href="${item.entityHref}"`);
    expect(html).toContain("7/25/26");
  });

  test("renders a safe detail dialog with actor note and close control", () => {
    const html = renderToStaticMarkup(
      <AuditDiffDialog
        item={item}
        labels={labels}
        locale="en-US"
        onClose={() => undefined}
        open
      />,
    );

    expect(html).toContain('data-testid="modal_audit_diff"');
    expect(html).toContain('data-testid="btn_close_audit_diff"');
    expect(html).toContain("Reviewed by operator");
    expect(html).toContain("Jul 25, 2026");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("uses imperative modal activation instead of a non-modal open attribute", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("./audit-diff-dialog.tsx", import.meta.url),
        "utf8",
      ),
    );

    expect(source).toContain("showModal()");
    expect(source).not.toContain("open={open}");
  });

  test("cycles keyboard focus inside the dialog in both directions", () => {
    expect(nextFocusIndex(1, 3, false)).toBe(2);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(2, 3, true)).toBe(1);
  });
});
