// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, test } from "vitest";
import messages from "../../../messages/en-US.json";
import { ManualRegisterForms } from "./manual-register-forms";

afterEach(cleanup);

test("company and vendor changes restrict manual entry choices and empty registers still offer entry", () => {
  render(<NextIntlClientProvider locale="en-US" messages={messages}><ManualRegisterForms choices={{
    companies: [{ id: "a", label: "Alpha" }, { id: "b", label: "Bravo" }],
    people: [{ id: "pa", label: "Alice", companyId: "a" }, { id: "pb", label: "Bob", companyId: "b" }],
    accounts: [{ id: "va", label: "Account A", vendorId: "v1" }, { id: "vb", label: "Account B", vendorId: "v2" }],
    licenses: [{ id: "la", label: "License A", vendorId: "v1" }, { id: "lb", label: "License B", vendorId: "v2" }],
  }} assignments={[]} recordAction={async () => { throw new Error("unconfigured"); }} closeAction={async () => { throw new Error("unconfigured"); }} /></NextIntlClientProvider>);
  expect(screen.getByRole("heading", { level: 2, name: messages.register.manualTitle })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 3, name: messages.register.manualClose })).toBeTruthy();
  expect((screen.getByLabelText(messages.register.licenseType) as HTMLSelectElement).name).toBe("licenseTypeId");
  expect((screen.getByLabelText(messages.register.endReason) as HTMLSelectElement).name).toBe("endReason");
  for (const [name, value] of [[messages.register.endReasonLeftCompany, "left_company"], [messages.register.endReasonInactive, "inactive"], [messages.register.endReasonReallocated, "reallocated"]]) {
    expect((screen.getByRole("option", { name }) as HTMLOptionElement).value).toBe(value);
  }
  expect(screen.getByRole("option", { name: "Alice" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Bob" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Company"), { target: { value: "b" } });
  expect(screen.getByRole("option", { name: "Bob" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Alice" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "vb" } });
  expect(screen.getByRole("option", { name: "License B" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "License A" })).toBeNull();
  expect((screen.getByRole("button", { name: "Record assignment" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Close assignment" }) as HTMLButtonElement).disabled).toBe(true);
  for (const note of screen.getAllByLabelText("Note")) {
    expect((note as HTMLTextAreaElement).required).toBe(true);
    expect((note as HTMLTextAreaElement).maxLength).toBe(2000);
  }
  expect((screen.getByLabelText("Start") as HTMLInputElement).type).toBe("date");
});

test("read-only finance receives no manual forms", () => {
  const { container } = render(<NextIntlClientProvider locale="en-US" messages={messages}><ManualRegisterForms choices={null} assignments={[]} recordAction={async () => undefined} closeAction={async () => undefined} /></NextIntlClientProvider>);
  expect(container.querySelector("form")).toBeNull();
});


test("an empty authorized catalog renders a required but unfillable entry form", () => {
  const { container } = render(<NextIntlClientProvider locale="en-US" messages={messages}><ManualRegisterForms choices={{ companies: [], people: [], accounts: [], licenses: [] }} assignments={[]} recordAction={async () => undefined} closeAction={async () => undefined} /></NextIntlClientProvider>);
  expect((screen.getByLabelText(messages.register.company) as HTMLSelectElement).options).toHaveLength(0);
  expect((screen.getByLabelText(messages.register.organization) as HTMLSelectElement).options).toHaveLength(0);
  expect(container.querySelector("form")!.checkValidity()).toBe(false);
});
