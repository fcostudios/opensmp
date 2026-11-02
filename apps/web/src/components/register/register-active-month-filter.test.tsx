// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test } from "vitest";

import { parseRegisterFilters } from "@smp/contracts/register";

import enMessages from "../../../messages/en-US.json";
import esMessages from "../../../messages/es-EC.json";
import { RegisterActiveMonthFilter } from "./register-active-month-filter";

afterEach(cleanup);

function renderIn(locale: "en-US" | "es-EC", value: string | undefined) {
  const messages = locale === "en-US" ? enMessages : esMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <form data-testid="form"><RegisterActiveMonthFilter value={value} /></form>
    </NextIntlClientProvider>,
  );
}

describe("US-098 active-in-month filter control", () => {
  test.each([
    ["es-EC", "Activas en el mes", "Cada licencia activa al menos un día del mes, tal como la factura el cierre mensual."],
    ["en-US", "Active in month", "Every seat active on at least one day of the month, as the month-end close bills it."],
  ] as const)("is a labelled, described month input in %s", (locale, label, hint) => {
    renderIn(locale, "2026-10");
    const input = screen.getByLabelText(label) as HTMLInputElement;
    expect(input.name).toBe("activeMonth");
    expect(input.type).toBe("month");
    expect(input.value).toBe("2026-10");
    expect(input.placeholder).toBe("YYYY-MM");
    expect(new RegExp(`^(?:${input.pattern})$`).test("2026-10")).toBe(true);
    expect(new RegExp(`^(?:${input.pattern})$`).test("2026-10-01")).toBe(false);
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe(hint);
  });

  test("an unset month submits an empty value that the canonical parser drops", () => {
    renderIn("en-US", undefined);
    const input = screen.getByLabelText("Active in month") as HTMLInputElement;
    expect(input.value).toBe("");
    const submitted = Object.fromEntries(new FormData(screen.getByTestId("form") as HTMLFormElement).entries());
    expect(submitted).toEqual({ activeMonth: "" });
    expect(parseRegisterFilters(submitted)).toEqual({});
  });
});
