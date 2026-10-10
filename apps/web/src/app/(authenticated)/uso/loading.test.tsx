// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, test } from "vitest";
import messages from "../../../../messages/es-EC.json";
import UsageLoading from "./loading";
afterEach(cleanup);
test("localized loading announces a polite busy status", () => {
  render(<NextIntlClientProvider locale="es-EC" messages={messages}><UsageLoading /></NextIntlClientProvider>);
  const status = screen.getByRole("status");
  expect(status.textContent).toBe(messages.usage.loading);
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.getAttribute("aria-busy")).toBe("true");
  expect(status.querySelectorAll(".grid > div").length).toBe(3);
  expect(status.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
});
