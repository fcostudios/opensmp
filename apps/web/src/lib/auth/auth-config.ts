import NextAuth from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";

import { projectLedgerSessionIdentity } from "./identity";

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
          scope: "openid profile email",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const identity = projectLedgerSessionIdentity(profile);
        token.sub = identity.id || undefined;
        token.name = identity.name;
        token.email = identity.email || undefined;
        token.accessToken = account.access_token;
        token.id_token = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      const identity = projectLedgerSessionIdentity(token);
      session.user.id = identity.id;
      session.user.name = identity.name;
      session.user.email = identity.email;
      session.accessToken = typeof token.accessToken === "string" ? token.accessToken : undefined;
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
