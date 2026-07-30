import {
  parseRegisterFilters,
  serializeRegisterFilters,
} from "@smp/contracts/register";
import { hasCapability } from "@smp/domain/identity-access";

import type { LedgerAuthorization } from "../identity-access/authorization";

/** Policy core for the read-only action; the framework adapter supplies fresh DB authorization. */
export function createRegisterCsvDownload(
  authorization: LedgerAuthorization | null,
  input: unknown,
): { readonly downloadUrl: string } {
  if (!authorization || !hasCapability(authorization, "finance:read") || (authorization.globalRole !== "group_admin" && authorization.globalRole !== "central_finance")) {
    throw new Error("Forbidden");
  }
  const filters = parseRegisterFilters(input);
  return { downloadUrl: `/api/exports/register?${serializeRegisterFilters(filters)}` };
}
