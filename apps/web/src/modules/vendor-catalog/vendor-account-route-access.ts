import { redirect } from "next/navigation";

import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import type { LedgerAuthorization } from "@/modules/identity-access/authorization";

/** Shared production guard for both vendor-account Server Component routes. */
export function requireVendorAccountAdmin(
  authorization: LedgerAuthorization | null,
): LedgerAuthorization {
  if (!authorization || authorization.globalRole !== "group_admin") {
    redirect(ROUTE_SCR_ACCESS_DENIED);
  }
  return authorization;
}
