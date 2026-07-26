import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import messages from "../../../messages/es-EC.json";
import { LocaleSelector } from "./locale-selector";

describe("LocaleSelector", () => {
  test("renders both persisted locale choices with an accessible label", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="es-EC"
        messages={messages}
        timeZone="America/Guayaquil"
      >
        <LocaleSelector
          updateLocaleAction={async () => undefined}
        />
      </NextIntlClientProvider>,
    );

    expect(markup).toContain('aria-label="Idioma"');
    expect(markup).toContain('<option value="es" selected="">Español</option>');
    expect(markup).toContain('<option value="en">English</option>');
  });
});
