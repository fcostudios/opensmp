export interface DomainCompany {
  readonly id: string;
  readonly domains: readonly string[];
}

export type DomainSuggestion =
  | { readonly kind: "empty"; readonly companyId: null }
  | { readonly kind: "unique"; readonly companyId: string }
  | { readonly kind: "unknown" | "ambiguous"; readonly companyId: null };

export function deriveDomainSuggestion(
  email: string,
  companies: readonly DomainCompany[],
): DomainSuggestion {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0) return { kind: "empty", companyId: null };
  const domain = normalized.slice(separator + 1);
  if (!domain.includes(".")) return { kind: "empty", companyId: null };
  const matches = companies.filter((company) =>
    company.domains.includes(domain),
  );
  if (matches.length === 1) {
    return { kind: "unique", companyId: matches[0]!.id };
  }
  return {
    kind: matches.length === 0 ? "unknown" : "ambiguous",
    companyId: null,
  };
}
