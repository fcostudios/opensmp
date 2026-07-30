import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- Shared lifecycle persistence runs inside a caller-owned transaction.
import { auditLog } from "@smp/db/schema";
// eslint-disable-next-line no-restricted-imports -- Shared lifecycle persistence runs inside a caller-owned transaction.
import * as schema from "@smp/db/schema";
import { permittedCompanyIds } from "@smp/domain/identity-access";
import {
  REQUEST_TRANSITIONS,
  assertLegalTransition,
  isApprovalDecisionTransition,
  type RequestState,
  type TransitionCommand,
} from "@smp/domain/request-workflow";

import {
  assertCapability,
  type LedgerAuthorization,
} from "../identity-access/authorization";
import {
  enqueueLifecycleDecision,
  enqueueLifecycleProvisioningComplete,
} from "./lifecycle-notifications";

type Database = NodePgDatabase<typeof schema>;
export type LedgerTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

type LockedRequestWire = {
  readonly companyId: string;
  readonly state: unknown;
};

export async function applyLockedRequestTransition(
  transaction: LedgerTransaction,
  authorization: LedgerAuthorization,
  command: TransitionCommand,
): Promise<void> {
  if (command.actorUserId !== authorization.userAccountId) {
    throw new Error("TRANSITION_ACTOR_MISMATCH");
  }
  const permitted = permittedCompanyIds(authorization, "request:approve");
  const companyScope =
    permitted === "all"
      ? sql`TRUE`
      : permitted.size === 0
        ? sql`FALSE`
        : sql`company_id IN (${sql.join(
            [...permitted].map(
              (companyId) => sql`${companyId}::uuid`,
            ),
            sql`, `,
          )})`;
  const locked = await transaction.execute<LockedRequestWire>(
    sql`SELECT company_id::text AS "companyId", state::text AS state
        FROM license_request
        WHERE id = ${command.requestId}::uuid
          AND ${companyScope}
        FOR UPDATE`,
  );
  const [request] = locked.rows;
  if (!request) throw new Error(`REQUEST_NOT_FOUND:${command.requestId}`);
  if (!isRequestState(request.state)) {
    throw new Error(`INVALID_REQUEST_STATE:${command.requestId}`);
  }
  assertCapability(authorization, "request:approve", request.companyId);
  if (request.state !== command.from) {
    throw new Error(
      `REQUEST_STATE_CONFLICT:${command.requestId}:${command.from}:${request.state}`,
    );
  }
  assertLegalTransition(command.from, command.to);

  const decision = isApprovalDecisionTransition(command.from, command.to);
  const updated = await transaction.execute<{ readonly id: string }>(
    decision
      ? sql`UPDATE license_request
            SET state = ${command.to}::license_request_state_enum,
                decided_by = ${authorization.userAccountId}::uuid,
                decided_at = ${command.occurredAt},
                decision_comment = ${command.note},
                updated_at = ${command.occurredAt}
            WHERE id = ${command.requestId}::uuid
              AND company_id = ${request.companyId}::uuid
              AND state = ${command.from}::license_request_state_enum
            RETURNING id::text AS id`
      : sql`UPDATE license_request
            SET state = ${command.to}::license_request_state_enum,
                updated_at = ${command.occurredAt}
            WHERE id = ${command.requestId}::uuid
              AND company_id = ${request.companyId}::uuid
              AND state = ${command.from}::license_request_state_enum
            RETURNING id::text AS id`,
  );
  if (updated.rows.length !== 1) {
    throw new Error(`REQUEST_UPDATE_CONFLICT:${command.requestId}`);
  }
  await transaction.execute(
    sql`INSERT INTO request_transition
          (request_id, from_state, to_state, actor_user_id, note, occurred_at)
        VALUES
          (${command.requestId}::uuid, ${command.from}, ${command.to},
           ${authorization.userAccountId}::uuid, ${command.note},
           ${command.occurredAt})`,
  );
  await transaction.insert(auditLog).values({
    actorUserId: authorization.userAccountId,
    action: `request.${command.to}`,
    entityType: "LicenseRequest",
    entityId: command.requestId,
    companyId: request.companyId,
    note: command.note,
    before: { state: command.from },
    after: { state: command.to },
    occurredAt: command.occurredAt,
  });
  if (command.to === "approved" || command.to === "rejected") {
    await enqueueLifecycleDecision(
      transaction,
      command.requestId,
      command.to,
      command.occurredAt,
    );
  }
  // Stryker disable next-line ConditionalExpression: @equivalent The enqueue
  // query independently requires the persisted request state to be active.
  if (command.to === "active") {
    await enqueueLifecycleProvisioningComplete(
      transaction,
      command.requestId,
      command.occurredAt,
    );
  }
}

function isRequestState(value: unknown): value is RequestState {
  return Object.prototype.hasOwnProperty.call(REQUEST_TRANSITIONS, String(value));
}
