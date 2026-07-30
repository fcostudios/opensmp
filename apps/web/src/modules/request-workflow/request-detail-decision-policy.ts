import { hasCapability } from "@smp/domain/identity-access";

import type { LedgerAuthorization } from "../identity-access/authorization";
import type { RequestState } from "./repository";

/** Visibility is derived only from the server-loaded Ledger authorization. */
export function canDecideRequestDetail(
  authorization: LedgerAuthorization,
  companyId: string,
  state: RequestState,
): boolean {
  return (
    state === "pending_approval" &&
    hasCapability(authorization, "request:approve", companyId)
  );
}
