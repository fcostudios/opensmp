// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test } from "vitest";

import type { LedgerAuthorization } from "@/modules/identity-access/authorization";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import VendorAccountsError, { VendorAccountsErrorView } from "./error";
import VendorAccountsLoading, { VendorAccountsLoadingView } from "./loading";
import { requireVendorAccountAdmin } from "@/modules/vendor-catalog/vendor-account-route-access";

const authorization = (
  globalRole: LedgerAuthorization["globalRole"],
): LedgerAuthorization => ({
  companyGrants: [],
  companyIds: [],
  employeeCompanyId: null,
  globalRole,
  idpSubject: `route-${globalRole ?? "none"}`,
  roles: globalRole ? [globalRole] : [],
  userAccountId: `account-${globalRole ?? "none"}`,
  userId: `user-${globalRole ?? "none"}`,
});

function expectAccessDenied(run: () => unknown): void {
  expect(run).toThrowError(expect.objectContaining({
    digest: expect.stringContaining(`;${ROUTE_SCR_ACCESS_DENIED};`),
  }));
}

afterEach(cleanup);

describe("shared registry/detail route authorization boundary", () => {
  test("redirects an anonymous request before protected data can load", () => {
    expectAccessDenied(() => requireVendorAccountAdmin(null));
  });

  test("redirects an authenticated non-admin before protected data can load", () => {
    expectAccessDenied(() => requireVendorAccountAdmin(authorization("central_finance")));
  });

  test("returns the exact group-admin authorization used by the real repository", () => {
    const admin = authorization("group_admin");
    expect(requireVendorAccountAdmin(admin)).toBe(admin);
  });
});

test("loading boundary renders its localized label as a polite status", () => {
  render(createElement(VendorAccountsLoadingView, { label: "Loading organizations" }));

  const status = screen.getByTestId("vendor_accounts_loading");
  expect(status.getAttribute("role")).toBe("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.textContent).toBe("Loading organizations");
});

test("loading route resolves real next-intl labels", () => {
  render(createElement(NextIntlClientProvider, {
    locale: "en-US",
    messages: { vendorAccounts: { loading: "Boundary loading" } },
    children: createElement(VendorAccountsLoading),
  }));
  expect(screen.getByRole("status").textContent).toBe("Boundary loading");
});

test("error boundary renders the failure and invokes exactly its supplied retry", () => {
  let retries = 0;
  render(createElement(VendorAccountsErrorView, {
    loadError: "Unable to load organizations",
    reset: () => { retries += 1; },
    retry: "Retry now",
  }));

  const alert = screen.getByTestId("vendor_accounts_error");
  expect(alert.getAttribute("role")).toBe("alert");
  expect(alert.textContent).toContain("Unable to load organizations");
  fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
  expect(retries).toBe(1);
});

test("error route resolves real next-intl labels and delegates retry", () => {
  let retries = 0;
  render(createElement(NextIntlClientProvider, {
    locale: "en-US",
    messages: { vendorAccounts: { loadError: "Boundary failure", retry: "Try again" } },
    children: createElement(VendorAccountsError, { reset: () => { retries += 1; } }),
  }));
  expect(screen.getByRole("alert").textContent).toContain("Boundary failure");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retries).toBe(1);
});
