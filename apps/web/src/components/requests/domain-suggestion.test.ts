import { describe, expect, test } from "vitest";

import { deriveDomainSuggestion } from "./domain-suggestion";

const companies = [
  {
    id: "12000000-0000-0000-0000-000000000006",
    domains: ["other.test"],
  },
  {
    id: "12000000-0000-0000-0000-000000000005",
    domains: ["acme.test"],
  },
] as const;

describe("deriveDomainSuggestion", () => {
  test("classifies normalized, invalid, unknown, unique, and ambiguous domains exactly", () => {
    expect(deriveDomainSuggestion("  MEMBER@ACME.TEST  ", companies)).toEqual({
      kind: "unique",
      companyId: companies[1].id,
    });
    for (const email of ["", "@acme.test", "member@", "member@localhost"]) {
      expect(deriveDomainSuggestion(email, companies)).toEqual({
        kind: "empty",
        companyId: null,
      });
    }
    expect(
      deriveDomainSuggestion("member@unknown.test", companies),
    ).toEqual({ kind: "unknown", companyId: null });
    expect(
      deriveDomainSuggestion("member@shared.test", [
        { id: "company-a", domains: ["shared.test"] },
        { id: "company-b", domains: ["shared.test"] },
      ]),
    ).toEqual({ kind: "ambiguous", companyId: null });
  });
});
