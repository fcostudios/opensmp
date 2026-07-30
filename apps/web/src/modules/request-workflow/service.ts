import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- This module owns the request transition transaction.
import * as schema from "@smp/db/schema";
import type { TransitionCommand } from "@smp/domain/request-workflow";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { applyLockedRequestTransition } from "./transition-core";

type Database = NodePgDatabase<typeof schema>;

export async function transitionRequest(
  database: Database,
  authorization: LedgerAuthorization,
  command: TransitionCommand,
): Promise<void> {
  await database.transaction(async (transaction) => {
    await applyLockedRequestTransition(
      transaction,
      authorization,
      command,
    );
  });
}
