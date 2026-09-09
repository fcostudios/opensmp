// eslint-disable-next-line no-restricted-imports -- This exact adapter wires the audited production retry transaction.
import { db } from "@smp/db";

import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import {
  createRetryProvisioningActionService,
  type RetryProvisioningDatabase,
} from "./retry-provisioning-action";

const productionDatabase = db as unknown as RetryProvisioningDatabase;
export const retryProvisioningActionService = createRetryProvisioningActionService({
  database: productionDatabase,
  loadAuthorization: loadCurrentLedgerAuthorization,
});
