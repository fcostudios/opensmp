import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    roles?: string[];
    orgId?: string;
    user: DefaultSession["user"] & { id: string };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    accessToken?: string;
    id_token?: string;
    org_id?: string;
    preferred_username?: string;
    realm_access?: { roles?: string[] };
  }
}
