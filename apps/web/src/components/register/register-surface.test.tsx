// @vitest-environment jsdom


import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  createRegisterFiltersSchema,
  parseRegisterFilters,
  serializeRegisterFilters,
} from "@smp/contracts/register";
import type { RegisterFilters as RegisterFilterValues } from "@smp/contracts/register";

import { createRegisterCsvDownload } from "@/modules/register/actions";

import { RegisterExportControl } from "./register-export-control";
import { RegisterFilters } from "./register-filters";
import { RegisterTable } from "./register-table";

afterEach(cleanup);

const labels = {
  all: "All", apply: "Apply", closed: "Closed", company: "Company",
  dateFrom: "From", dateTo: "To", endReason: "End reason", endReasonInactive: "Inactive", endReasonLeftCompany: "Left", endReasonReallocated: "Reallocated",
  licenseType: "License type", open: "Open", openState: "State",
  organization: "Organization", person: "Person", source: "Source",
  sourceImport: "Import", sourceKind: "Source kind", sourceReconciliation: "Reconciliation", sourceRequestNo: "Request no",
};

describe("register surface contracts", () => {
  test("shows the source approval decision and usable statement trace in the finance drilldown", () => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
    render(
      <RegisterTable
        canViewRequests={false}
        canViewStatements
        items={[{
          companyCode: "ALP",
          companyId: "00000000-0000-4000-8000-000000003302",
          companyName: "Alpha Company",
          endReason: null,
          endedOn: "2026-02-28",
          id: "00000000-0000-4000-8000-000000003315",
          licenseTypeId: "00000000-0000-4000-8000-000000003307",
          licenseTypeName: "Enterprise",
          note: null,
          personId: "00000000-0000-4000-8000-000000003309",
          personName: "Alicia",
          sourceKind: "request",
          sourceRequestApprovalState: "approved",
          sourceRequestDecidedAt: "2026-02-02T18:30:00.000Z",
          sourceRequestId: "00000000-0000-4000-8000-000000003313",
          sourceRequestNo: "SOL-1001",
          startedOn: "2026-02-03",
          statementLines: [{
            amountUsd: "10.00",
            assignmentId: "00000000-0000-4000-8000-000000003315",
            companyId: "00000000-0000-4000-8000-000000003302",
            id: "00000000-0000-4000-8000-000000003321",
            licenseDays: 26,
            periodFrom: "2026-02-03",
            periodTo: "2026-02-28",
            statementId: "00000000-0000-4000-8000-000000003319",
            statementPeriod: "2026-02",
          }],
          vendorAccountId: "00000000-0000-4000-8000-000000003305",
          vendorAccountName: "Register Org A",
        }]}
        labels={{
          company: "Company", companyCode: "Company", drilldownClose: "Close",
          drilldownDecisionDate: "Decided on", drilldownSource: "Source request",
          drilldownStatementLines: "Statement lines", drilldownTitle: "Assignment trace",
          empty: "Empty", endReason: "End reason", endReasonInactive: "Inactive",
          endReasonLeftCompany: "Left", endReasonReallocated: "Reallocated",
          endedOn: "End", licenseType: "License", note: "Note",
          organization: "Organization", person: "Person", requestApproved: "Approved",
          requestPending: "Pending", requestRejected: "Rejected", source: "Source",
          sourceImport: "Import", sourceReconciliation: "Reconciliation",
          sourceRequest: "Request", startedOn: "Start", tableCaption: "Assignments",
          viewStatement: "View statement",
        }}
        locale="en-US"
      />,
    );

    const sourceTrace = screen.getByRole("button", { name: "Request SOL-1001" });
    fireEvent.click(sourceTrace);

    expect(screen.getByText("SOL-1001 · Approved · Decided on 2/2/2026")).toBeTruthy();
    expect(screen.getByText("2/3/2026")).toBeTruthy();
    expect(screen.getByText("2/28/2026")).toBeTruthy();
    expect(screen.getByText("2/3/2026 – 2/28/2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View statement" }).getAttribute("href")).toBe(
      "/estados-de-cuenta/00000000-0000-4000-8000-000000003319",
    );
  });

  test("renders an accessible localized error when the real export policy rejects authorization", async () => {
    render(
      <RegisterExportControl
        errorLabel="We couldn't export the register."
        filters={parseRegisterFilters({})}
        label="Export CSV"
        requestDownload={async (filters) => createRegisterCsvDownload(null, filters)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "We couldn't export the register.",
    );
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Export CSV" }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  test("renders every supported filter and submits its URL values through the canonical parser", () => {
    const { container } = render(
      <RegisterFilters
        companies={[{ id: "00000000-0000-4000-8000-000000003302", label: "Alpha" }]}
        endReasons={["inactive"]}
        filters={parseRegisterFilters({ personId: "00000000-0000-4000-8000-000000003309", sourceKind: "request", sourceRequestNo: "SOL-1001", endReason: "inactive" })}
        labels={labels}
        licenseTypes={[{ id: "00000000-0000-4000-8000-000000003307", label: "Enterprise" }]}
        people={[{ id: "00000000-0000-4000-8000-000000003309", label: "Alicia" }]}
        sourceRequestNos={["SOL-1001"]}
        vendorAccounts={[{ id: "00000000-0000-4000-8000-000000003305", label: "Org" }]}
      />,
    );
    const form = container.querySelector("form")!;
    expect(screen.getByLabelText(labels.person)).toBeTruthy();
    expect(screen.getByLabelText(labels.sourceKind)).toBeTruthy();
    expect(screen.getByLabelText(labels.sourceRequestNo)).toBeTruthy();
    expect(screen.getByLabelText(labels.endReason)).toBeTruthy();
    const submitted = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    expect(serializeRegisterFilters(parseRegisterFilters(submitted))).toBe("endReason=inactive&personId=00000000-0000-4000-8000-000000003309&sourceKind=request&sourceRequestNo=SOL-1001");
  });

  test("rejects impossible ISO calendar dates", () => {
    expect(() => parseRegisterFilters({ startDate: "2026-02-29" })).toThrow("Invalid register filters");
    expect(() => parseRegisterFilters({ startDate: "2024-02-29" })).not.toThrow();
  });

  test.each([
    null,
    [],
    "filters",
    42,
    { companyId: ["00000000-0000-4000-8000-000000003302"] },
    { companyId: 42 },
  ])("rejects non-canonical filter input %#", (input) => {
    expect(() => parseRegisterFilters(input)).toThrow("Invalid register filters");
  });

  test.each([
    "2024-2-29",
    "2024-02-2",
    "2024/02/29",
    "2024-02-29 ",
    "2024-02-30",
  ])("requires an exact valid ISO calendar date: %s", (startDate) => {
    expect(() => parseRegisterFilters({ startDate })).toThrow("Invalid register filters");
  });

  test("serializes independently supplied filters in canonical key order", () => {
    const deliberatelyUnsorted: RegisterFilterValues = {
      vendorAccountId: "00000000-0000-4000-8000-000000003305",
      companyId: "00000000-0000-4000-8000-000000003302",
    };
    expect(serializeRegisterFilters(deliberatelyUnsorted)).toBe("companyId=00000000-0000-4000-8000-000000003302&vendorAccountId=00000000-0000-4000-8000-000000003305");
  });

  test("enforces every scalar filter boundary and canonical normalization", () => {
    const uuid = "00000000-0000-4000-8000-000000003302";
    expect(parseRegisterFilters({
      companyId: uuid,
      cursor: "x",
      endDate: "2026-12-31",
      endReason: "left_company",
      licenseTypeId: uuid,
      limit: "100",
      openState: "closed",
      personId: uuid,
      sourceKind: "reconciliation",
      sourceRequestNo: "  SOL-1  ",
      startDate: "2026-01-01",
      vendorAccountId: uuid,
    })).toEqual({
      companyId: uuid,
      cursor: "x",
      endDate: "2026-12-31",
      endReason: "left_company",
      licenseTypeId: uuid,
      limit: 100,
      openState: "closed",
      personId: uuid,
      sourceKind: "reconciliation",
      sourceRequestNo: "SOL-1",
      startDate: "2026-01-01",
      vendorAccountId: uuid,
    });
    const normalizedEmpty = parseRegisterFilters({
      companyId: undefined,
      sourceRequestNo: "",
    });
    expect(normalizedEmpty).toEqual({});
    expect(Object.keys(normalizedEmpty)).toEqual([]);
    expect(serializeRegisterFilters({ companyId: undefined })).toBe("");
    const reversed = createRegisterFiltersSchema().safeParse({
      startDate: "2026-02-02",
      endDate: "2026-02-01",
    });
    expect(reversed.success).toBe(false);
    if (!reversed.success) {
      expect(reversed.error.issues).toEqual([{
        code: "custom",
        message: "startDate must not be after endDate",
        path: ["endDate"],
      }]);
    }
    expect(createRegisterFiltersSchema().safeParse({ startDate: "2026-02-02" }).success).toBe(true);
    expect(createRegisterFiltersSchema().safeParse({ endDate: "2026-02-02" }).success).toBe(true);
    for (const invalid of [
      { cursor: "" },
      { cursor: "x".repeat(501) },
      { endReason: "" },
      { endReason: "other" },
      { limit: "0" },
      { limit: "101" },
      { limit: "1.5" },
      { openState: "" },
      { openState: "all" },
      { sourceKind: "" },
      { sourceKind: "other" },
      { sourceRequestNo: " " },
      { sourceRequestNo: "x".repeat(201) },
    ]) {
      expect(createRegisterFiltersSchema().safeParse(invalid).success).toBe(false);
    }
  });
});
