// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { RatesView } from "./rates-view";
import type { RatesWorkspace } from "./rate-service";

afterEach(cleanup);
const action = async () => ({ status: "success" as const });
const data: RatesWorkspace = {
  accounts: [{ id: "org", name: "Pilot org", vendorId: "vendor" }],
  licenses: [{ id: "seat", name: "Seat", vendorId: "vendor" }],
  rates: [{ id: "rate", vendorAccountId: "org", licenseTypeId: "seat", accountName: "Pilot org", licenseName: "Seat", monthlyRateUsd: "62.00", effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31", provisional: true, locked: true }],
  capacity: [{ id: "capacity", accountName: "Pilot org", licenseName: "Seat", purchasedQty: 140, effectiveFrom: "2026-01-01", note: "Annual purchase" }],
};

test("renders live rates and capacity together, labels provisional rates and blocks locked edits", () => {
  render(<RatesView data={data} action={action} />);
  expect(screen.getAllByRole("table")).toHaveLength(2);
  for (const [table, labels] of [
    ["rates_table", ["Organization", "License type", "Monthly rate (USD)", "Effective from", "Effective to (inclusive)", "Evidence", "Final close"]],
    ["capacity_table", ["Organization", "License type", "Purchased quantity", "Effective from", "Note"]],
  ] as const) for (const label of labels) expect(within(screen.getByTestId(table)).getByRole("columnheader", { name: label })).toBeTruthy();
  expect(screen.queryByText("No rates yet")).toBeNull();
  expect(screen.queryByText("No purchases recorded")).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel edit" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByTestId("rates_table").textContent).toContain("$62.00");
  expect(screen.getByTestId("rates_table").textContent).toContain("Provisional");
  expect(screen.getByTestId("rates_table").textContent).toContain("2026-01-31");
  expect(screen.getByTestId("rates_table").textContent).toContain("Locked");
  expect(screen.queryByRole("button", { name: "Edit rate" })).toBeNull();
  expect(screen.getByTestId("capacity_table").textContent).toContain("140");
  expect(screen.getByTestId("capacity_table").textContent).toContain("Annual purchase");
  expect(screen.getByLabelText("Provisional rate").getAttribute("type")).toBe("checkbox");
});

test("editing preserves each row's closed period and vendor selection, switches rows cleanly, and cancels unsaved values", () => {
  const other = { ...data.rates[0], id: "other-rate", vendorAccountId: "other-org", licenseTypeId: "other-seat",
    accountName: "Other org", licenseName: "Other seat", monthlyRateUsd: "80.00", effectiveFrom: "2026-02-01", effectiveTo: "2026-02-28", locked: false };
  render(<RatesView data={{ ...data,
    accounts: [...data.accounts, { id: "other-org", name: "Other org", vendorId: "other-vendor" }],
    licenses: [...data.licenses, { id: "other-seat", name: "Other seat", vendorId: "other-vendor" }],
    rates: [{ ...data.rates[0], locked: false }, other],
  }} action={action} />);
  const account = () => screen.getByLabelText("Organization") as HTMLSelectElement;
  const license = () => screen.getByLabelText("License type") as HTMLSelectElement;
  fireEvent.change(account(), { target: { value: "other-org" } });
  expect(within(license()).queryByRole("option", { name: "Seat" })).toBeNull();
  expect(within(license()).getByRole("option", { name: "Other seat" })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Edit rate" })[0]);
  expect(account().value).toBe("org"); expect(license().value).toBe("seat");
  expect((screen.getByLabelText("Effective to (inclusive)") as HTMLInputElement).value).toBe("2026-01-31");
  fireEvent.change(screen.getByLabelText("Monthly rate (USD)"), { target: { value: "99" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Edit rate" })[1]);
  expect(account().value).toBe("other-org"); expect(license().value).toBe("other-seat");
  expect((screen.getByLabelText("Monthly rate (USD)") as HTMLInputElement).value).toBe("80.00");
  expect((screen.getByLabelText("Effective from") as HTMLInputElement).value).toBe("2026-02-01");
  expect((screen.getByLabelText("Effective to (inclusive)") as HTMLInputElement).value).toBe("2026-02-28");
  fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
  expect(screen.queryByRole("button", { name: "Cancel edit" })).toBeNull();
  expect(account().value).toBe(""); expect(license().value).toBe("");
  expect((screen.getByLabelText("Monthly rate (USD)") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Effective from") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Effective to (inclusive)") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("shows empty states and permits editing an unlocked contracted rate", () => {
  const { unmount } = render(<RatesView data={{ ...data, rates: [], capacity: [] }} action={action} />);
  expect(screen.getByText("No rates yet")).toBeTruthy();
  expect(screen.getByText("No purchases recorded")).toBeTruthy();
  unmount();
  render(<RatesView data={{ ...data, rates: [{ ...data.rates[0], locked: false, provisional: false, effectiveTo: null }] }} action={action} />);
  expect(screen.getByTestId("rates_table").textContent).toContain("Contracted");
  fireEvent.click(screen.getByRole("button", { name: "Edit rate" }));
  expect((screen.getByLabelText("Monthly rate (USD)") as HTMLInputElement).value).toBe("62.00");
  expect((screen.getByLabelText("Provisional rate") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("Effective to (inclusive)") as HTMLInputElement).value).toBe("");
});
