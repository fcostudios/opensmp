// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, test } from "vitest";
import messages from "../../../../messages/en-US.json";
import UsageError from "./error";
afterEach(cleanup);
test("localized error hides internal details and invokes its supplied retry", () => {
  let retries = 0;
  render(<NextIntlClientProvider locale="en-US" messages={messages}><UsageError error={new Error("database private detail")} reset={() => { retries += 1; }} /></NextIntlClientProvider>);
  expect(screen.getByRole("alert").textContent).toContain(messages.usage.loadError);
  expect(screen.getByRole("alert").textContent).not.toContain("database private detail");
  fireEvent.click(screen.getByRole("button", { name: messages.usage.retry }));
  expect(retries).toBe(1);
});
