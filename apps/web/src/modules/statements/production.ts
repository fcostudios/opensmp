// eslint-disable-next-line no-restricted-imports -- Production composition for the scoped statement repository.
import { db } from "@smp/db";
import { createStatementRepository } from "./repository";
import type { LedgerAuthorization } from "../identity-access/authorization";

const repository = createStatementRepository(db as unknown as Parameters<typeof createStatementRepository>[0]);
export async function loadStatementRegister(authorization: LedgerAuthorization, input: unknown) {
  return repository.read(authorization, input);
}
