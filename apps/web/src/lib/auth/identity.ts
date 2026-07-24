type OidcIdentityClaims = {
  email?: string | null;
  family_name?: string | null;
  given_name?: string | null;
  name?: string | null;
  sub?: string | null;
};

export function projectLedgerSessionIdentity<T extends OidcIdentityClaims>(claims: T) {
  return {
    id: claims.sub ?? "",
    name: claims.name ?? `${claims.given_name ?? ""} ${claims.family_name ?? ""}`.trim(),
    email: claims.email ?? "",
  };
}
