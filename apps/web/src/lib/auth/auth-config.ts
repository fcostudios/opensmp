import NextAuth from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";

const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER
  ?? "http://localhost:8180/realms/corporativo";
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
  ?? "smp-web";

type KeycloakProfileClaims = {
  org_id?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
};

type KeycloakTokenClaims = {
  accessToken?: string;
  org_id?: string;
  realm_access?: { roles?: string[] };
};

export const { handlers: { GET, POST }, auth, signIn, signOut } = NextAuth({
  providers: [
    KeycloakProvider({
      clientId: KEYCLOAK_CLIENT_ID,
      issuer: KEYCLOAK_ISSUER,
      authorization: {
        params: {
          scope: "openid profile email roles",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        // First login — extract Keycloak claims
        const claims = profile as typeof profile & KeycloakProfileClaims;
        token.sub = profile.sub ?? undefined;
        token.name = profile.name ?? `${profile.given_name ?? ""} ${profile.family_name ?? ""}`.trim();
        token.email = profile.email ?? undefined;
        token.preferred_username = claims.preferred_username;
        token.realm_access = claims.realm_access;
        token.org_id = claims.org_id;
        token.accessToken = account.access_token;
        token.id_token = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      const claims = token as typeof token & KeycloakTokenClaims;
      session.user.id = token.sub ?? "";
      session.user.name = token.name ?? "";
      session.user.email = token.email ?? "";
      session.accessToken = claims.accessToken;
      session.roles = claims.realm_access?.roles ?? [];
      session.orgId = claims.org_id;
      return session;
    },
  },
  events: {
    async signOut(message) {
      // End Keycloak SSO session on logout
      const issuer = KEYCLOAK_ISSUER;
      const token = "token" in message ? message.token : undefined;
      const logoutUrl = `${issuer}/protocol/openid-connect/logout?id_token_hint=${token?.id_token ?? ""}&post_logout_redirect_uri=${encodeURIComponent(process.env.NEXTAUTH_URL ?? "http://localhost:3000")}`;
      try { await fetch(logoutUrl); } catch {}
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});
