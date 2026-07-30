import type { LedgerAuthorization } from "../../identity-access/authorization";

export async function loadProductionChecklistAuthorization(): Promise<
  LedgerAuthorization | null
> {
  const { loadCurrentLedgerAuthorization } = await import(
    "../../identity-access/server-authorization"
  );
  return loadCurrentLedgerAuthorization();
}

export function productionChecklistClock(): Date {
  return new Date();
}
