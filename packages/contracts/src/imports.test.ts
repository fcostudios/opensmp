import { describe, expect, it } from "vitest";

import {
  parseCapacityCsv,
  parseCompaniesCsv,
  parseMemberBackfillCsv,
} from "./imports";

describe("US-007 CSV contracts", () => {
  it("normalizes company codes and contact emails without losing the finance contact", () => {
    expect(
      parseCompaniesCsv(
        [
          "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
          " acme ,Acme Holdings,internal, Approver@Example.COM , FINANCE@example.com ,1500.25,es",
        ].join("\n"),
      ),
    ).toEqual([
      {
        code: "ACME",
        name: "Acme Holdings",
        type: "internal",
        approverEmail: "approver@example.com",
        financeContactEmail: "finance@example.com",
        budgetMonthlyUsd: "1500.25",
        statementLanguage: "es",
      },
    ]);
  });

  it("parses quoted commas and exact member/capacity contracts", () => {
    expect(
      parseMemberBackfillCsv(
        [
          "vendor_org_ref,email,full_name,company_code,license_type,started_on",
          'org-1,person@example.com,"Lomas, Elena",acme,Enterprise,2026-08-01',
        ].join("\n"),
      )[0],
    ).toMatchObject({
      companyCode: "ACME",
      fullName: "Lomas, Elena",
      startedOn: "2026-08-01",
    });
    expect(
      parseCapacityCsv(
        [
          "vendor_org_ref,license_type,purchased_qty,effective_from,note",
          'org-1,Enterprise,30,2026-08-01,"Initial, signed"',
        ].join("\n"),
      ),
    ).toEqual([
      {
        vendorOrgRef: "org-1",
        licenseType: "Enterprise",
        purchasedQty: 30,
        effectiveFrom: "2026-08-01",
        note: "Initial, signed",
      },
    ]);
  });

  it.each([
    "api_key",
    "admin_key",
    "analytics_token",
    "encrypted_secret",
    "password",
  ])("rejects credential-bearing column %s", (column) => {
    expect(() =>
      parseCompaniesCsv(
        [
          `code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language,${column}`,
          "ACME,Acme,internal,a@example.com,f@example.com,1,es,secret",
        ].join("\n"),
      ),
    ).toThrow(/credential column/i);
  });

  it("rejects malformed rows and non-exact headers", () => {
    expect(() =>
      parseCompaniesCsv(
        "name,code,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language\nAcme,ACME,internal,a@example.com,f@example.com,1,es",
      ),
    ).toThrow(/header/i);
    expect(() =>
      parseMemberBackfillCsv(
        "vendor_org_ref,email,full_name,company_code,license_type,started_on\norg,a@example.com,A,ACME,Enterprise,not-a-date",
      ),
    ).toThrow(/started_on/i);
  });

  it("rejects a contact email reused in either company role", () => {
    expect(() =>
      parseCompaniesCsv(
        [
          "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
          "ONE,One,internal,same@example.com,finance@example.com,1,es",
          "TWO,Two,internal,approver@example.com,same@example.com,1,en",
        ].join("\n"),
      ),
    ).toThrow(/duplicate contact email/i);
  });

  it("allows only one capacity snapshot per vendor org and license type", () => {
    expect(() =>
      parseCapacityCsv(
        [
          "vendor_org_ref,license_type,purchased_qty,effective_from,note",
          "org-1,Enterprise,30,2026-08-01,Initial",
          "org-1,Enterprise,31,2026-08-02,Duplicate snapshot",
        ].join("\n"),
      ),
    ).toThrow(/duplicate capacity pool\/license key/i);
  });
});
