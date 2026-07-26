import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

import {
  exposeLedgerSession,
  projectKeycloakJwt,
  safeAuthRedirect,
} from "./auth-callbacks";
import {
  completeKeycloakSignIn,
  loadLedgerSessionUser,
  type KeycloakOidcProfile,
} from "@/modules/identity-access/session";

const keycloakIssuer =
  process.env.KEYCLOAK_ISSUER ??
  "http://localhost:8180/realms/corporativo";

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID ?? "smp-web",
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      issuer: keycloakIssuer,
      authorization: {
        params: {
          scope: "openid profile email",
        },
      },
    }),
  ],
  callbacks: {
    redirect: safeAuthRedirect,
    async signIn({ account, profile }) {
      if (account?.provider !== "keycloak" || !profile) {
        return false;
      }
      await completeKeycloakSignIn(profile as KeycloakOidcProfile);
      return true;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "keycloak" && profile) {
        const keycloakProfile = profile as KeycloakOidcProfile;
        token = projectKeycloakJwt(
          token,
          { idToken: account.id_token },
          keycloakProfile,
        );
      }
      return token;
    },
    async session({ session, token }) {
      if (
        typeof token.idpSubject !== "string" ||
        !token.idpSubject ||
        typeof token.displayName !== "string"
      ) {
        throw new Error("Authenticated session is missing its OIDC identity");
      }
      const ledgerUser = await loadLedgerSessionUser({
        subject: token.idpSubject,
        name: token.displayName,
      });
      return exposeLedgerSession(session, ledgerUser);
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});

export { keycloakIssuer };
