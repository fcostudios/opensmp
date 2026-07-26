import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import messages from "../../../messages/en-US.json";
import { Header } from "./header";

describe("Header", () => {
  test("renders translated route context and real user controls without fixture chrome", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en-US"
        messages={messages}
        timeZone="America/Guayaquil"
      >
        <Header
          breadcrumbs={[
            { titleKey: "pages.companias.title", href: "/companias" },
            {
              label: "Kickoff",
              href: null,
            },
          ]}
          displayName="Ada Lovelace"
          titleKey="pages.companias/[companyId].title"
          updateLocaleAction={async () => undefined}
        />
      </NextIntlClientProvider>,
    );

    expect(markup).toContain(">Companies</a>");
    expect(markup).toContain(">Kickoff</span>");
    expect(markup).toContain(">Company details</h1>");
    expect(markup).toContain("font-display");
    expect(markup).toContain("uppercase");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain('aria-label="Language"');
    expect(markup).toContain('data-testid="btn_logout"');
    expect(markup).not.toContain("Notifications");
    expect(markup).not.toContain(">3<");
    expect(markup).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
  });
});
