import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import messages from "../../../messages/en-US.json";
import { MobileBar } from "./mobile-bar";

describe("MobileBar", () => {
  test("renders an accessible closed sheet containing only generated role destinations and real account controls", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en-US"
        messages={messages}
        timeZone="America/Guayaquil"
      >
        <MobileBar
          displayName="Ada Lovelace"
          pathname="/solicitudes"
          roles={["employee"]}
          updateLocaleAction={async () => undefined}
        />
      </NextIntlClientProvider>,
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="mobile-navigation-sheet"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('id="mobile-navigation-sheet"');
    expect(markup).toContain("hidden");
    expect(markup).toContain(">My requests</span>");
    expect(markup).not.toContain(">Dashboard</span>");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain('data-testid="btn_logout_mobile"');
    expect(markup).toContain('aria-label="Language"');
  });
});
