import NextAuth from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";

const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER
  ?? "http://localhost:8180/realms/corporativo";
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
  ?? "smp-web";

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
        token.sub = profile.sub;
        token.name = profile.name ?? `${profile.given_name ?? ""} ${profile.family_name ?? ""}`.trim();
        token.email = profile.email;
        token.preferred_username = (profile as any).preferred_username;
        token.realm_access = (profile as any).realm_access;
        token.org_id = (profile as any).org_id;
        token.accessToken = account.access_token;
        token.id_token = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.name = token.name ?? "";
      session.user.email = token.email ?? "";
      (session as any).accessToken = token.accessToken;
      (session as any).roles = (token.realm_access as any)?.roles ?? [];
      (session as any).orgId = token.org_id;
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      // End Keycloak SSO session on logout
      const issuer = KEYCLOAK_ISSUER;
      const logoutUrl = `${issuer}/protocol/openid-connect/logout?id_token_hint=${(token as any)?.id_token ?? ""}&post_logout_redirect_uri=${encodeURIComponent(process.env.NEXTAUTH_URL ?? "http://localhost:3000")}`;
      try { await fetch(logoutUrl); } catch {}
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});
