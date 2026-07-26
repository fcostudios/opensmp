import type { LedgerSessionUser } from "./auth-types";

export interface SafeKeycloakProfile {
  readonly email?: string | null;
  readonly family_name?: string | null;
  readonly given_name?: string | null;
  readonly name?: string | null;
  readonly sub?: string | null;
}

export function oidcDisplayName(profile: SafeKeycloakProfile): string {
  return (
    profile.name?.trim() ||
    `${profile.given_name ?? ""} ${profile.family_name ?? ""}`.trim() ||
    profile.email?.trim() ||
    ""
  );
}

export function projectKeycloakJwt<
  T extends Record<string, unknown>,
  P extends SafeKeycloakProfile,
>(
  currentToken: T,
  account: { readonly idToken?: string },
  profile: P,
): T & {
  displayName: string;
  idToken?: string;
  idpSubject: string;
} {
  const token = {
    ...currentToken,
    displayName: oidcDisplayName(profile),
    idToken: account.idToken,
    idpSubject: profile.sub ?? "",
  };
  delete token.accessToken;
  delete token.access_token;
  delete token.id_token;
  return token;
}

export function exposeLedgerSession<T extends { readonly expires: string }>(
  session: T,
  user: LedgerSessionUser,
): { expires: string; user: LedgerSessionUser } {
  return { expires: session.expires, user };
}

export function safeAuthRedirect({
  url,
  baseUrl,
}: {
  readonly url: string;
  readonly baseUrl: string;
}): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash
    ) {
      throw new Error("unsafe base URL");
    }
  } catch {
    throw new Error("Auth.js base URL must be a valid application origin");
  }
  const landing = new URL("/auth/landing", base).toString();
  try {
    const target = new URL(url, base);
    if (
      target.origin !== base.origin ||
      target.username ||
      target.password
    ) {
      return landing;
    }
    return target.pathname === "/" ? landing : target.toString();
  } catch {
    // Invalid and cross-origin targets both fail closed to role landing.
    return landing;
  }
}
