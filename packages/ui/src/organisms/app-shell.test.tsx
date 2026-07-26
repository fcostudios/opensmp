import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  test("renders the desktop rail, mobile chrome, header, and focusable content landmarks exactly once", () => {
    const headerLabel = "Header";
    const workspaceLabel = "Workspace";
    const markup = renderToStaticMarkup(
      <AppShell
        desktopNavigation={<nav aria-label="Desktop navigation" />}
        header={<header>{headerLabel}</header>}
        mobileNavigation={<nav aria-label="Mobile navigation" />}
      >
        <article>{workspaceLabel}</article>
      </AppShell>,
    );

    expect(markup.match(/data-shell-slot="desktop-navigation"/g)).toHaveLength(
      1,
    );
    expect(markup.match(/data-shell-slot="mobile-navigation"/g)).toHaveLength(
      1,
    );
    expect(markup.match(/data-shell-slot="header"/g)).toHaveLength(1);
    expect(markup.match(/id="main-content"/g)).toHaveLength(1);
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("<article>Workspace</article>");
    expect(markup).toContain("md:pl-16");
    expect(markup).toContain("lg:pl-[248px]");
    expect(markup).not.toContain("md:pl-[248px]");
  });
});
