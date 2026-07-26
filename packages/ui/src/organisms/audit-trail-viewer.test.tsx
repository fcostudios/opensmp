import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { AuditTrailViewer } from "./audit-trail-viewer";

describe("AuditTrailViewer", () => {
  test("renders note and explicit removal/addition markers without injecting HTML", () => {
    const html = renderToStaticMarkup(
      <AuditTrailViewer
        after={{ name: "<img src=x onerror=alert(1)>", status: "active" }}
        before={{ name: "Before", legacy: true }}
        labels={{
          added: "Added",
          after: "After",
          before: "Before",
          note: "Note",
          removed: "Removed",
        }}
        note="Approved after review"
      />,
    );

    expect(html).toContain("− legacy");
    expect(html).toContain("+ status");
    expect(html).toContain("Approved after review");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});

