import type { LedgerSessionUser } from "@/lib/auth/auth-types";

declare module "next-auth" {
  interface Session {
    user: LedgerSessionUser;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: never;
    access_token?: never;
    displayName?: string;
    idToken?: string;
    id_token?: never;
    idpSubject?: string;
  }
}
