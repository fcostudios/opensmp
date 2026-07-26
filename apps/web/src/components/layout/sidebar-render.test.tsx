import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import messages from "../../../messages/en-US.json";
import { Sidebar } from "./sidebar";

function renderSidebar(
  roles: readonly string[],
  pathname = "/solicitudes",
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en-US"
      messages={messages}
      timeZone="America/Guayaquil"
    >
      <Sidebar pathname={pathname} roles={roles} />
    </NextIntlClientProvider>,
  );
}

describe("Sidebar", () => {
  test("renders the exact translated sections and one filled active item for group admin", () => {
    const markup = renderSidebar(["group_admin"], "/cierre");

    expect(markup).toContain(">OPERATIONS</h2>");
    expect(markup).toContain(">FINANCE</h2>");
    expect(markup).toContain(">ADMINISTRATION</h2>");
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain("bg-chrome-active");
    expect(markup).toContain("w-16");
    expect(markup).toContain("lg:w-[248px]");
    expect(markup).toContain("sr-only lg:not-sr-only");
    expect(markup).not.toContain('style="width:248px"');
  });

  test("omits empty privileged sections for an employee", () => {
    const markup = renderSidebar(["employee"]);

    expect(markup).toContain(">OPERATIONS</h2>");
    expect(markup).toContain(">My requests</span>");
    expect(markup).not.toContain(">FINANCE</h2>");
    expect(markup).not.toContain(">ADMINISTRATION</h2>");
    expect(markup).not.toContain(">Dashboard</span>");
  });
});
