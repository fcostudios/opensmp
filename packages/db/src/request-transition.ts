import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "./schema.js";

type Database = NodePgDatabase<typeof schema>;
export type RequestTransitionTransaction = Pick<Database, "execute">;
type RequestState = (typeof schema.license_request_state_enum.enumValues)[number];
type TransitionCommand = Readonly<{
  requestId: string;
  from: RequestState;
  to: RequestState;
  actorUserId: string | null;
  note: string | null;
  occurredAt: Date;
}>;

type LockedRequest = Readonly<{
  companyId: string;
  state: RequestState;
}>;

export async function applyRequestTransitionInTransaction(
  transaction: RequestTransitionTransaction,
  command: TransitionCommand,
  { expectedCompanyId }: { readonly expectedCompanyId: string },
): Promise<LockedRequest> {
  const locked = await transaction.execute<LockedRequest>(
    sql`SELECT company_id::text AS "companyId", state::text AS state
        FROM license_request
        WHERE id = ${command.requestId}::uuid
          AND company_id = ${expectedCompanyId}::uuid
        FOR UPDATE`,
  );
  const [request] = locked.rows;
  if (!request) throw new Error(`REQUEST_NOT_FOUND:${command.requestId}`);
  if (request.state !== command.from) {
    throw new Error(
      `REQUEST_STATE_CONFLICT:${command.requestId}:${command.from}:${request.state}`,
    );
  }
  const decision = command.from === "pending_approval"
    && (command.to === "approved" || command.to === "rejected");
  const updated = await transaction.execute<{ readonly id: string }>(
    decision
      ? sql`UPDATE license_request
            SET state = ${command.to}::license_request_state_enum,
                decided_by = ${command.actorUserId}::uuid,
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
           ${command.actorUserId}::uuid, ${command.note}, ${command.occurredAt})`,
  );
  await transaction.execute(
    sql`INSERT INTO audit_log
          (actor_user_id, action, entity_type, entity_id, company_id,
           note, before, after, occurred_at)
        VALUES
          (${command.actorUserId}::uuid, ${`request.${command.to}`},
           'LicenseRequest', ${command.requestId}::uuid, ${request.companyId}::uuid,
           ${command.note}, ${JSON.stringify({ state: command.from })}::jsonb,
           ${JSON.stringify({ state: command.to })}::jsonb, ${command.occurredAt})`,
  );
  return request;
}
