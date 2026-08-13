import { randomUUID } from "node:crypto";

import {
  createConnectorDispatcher,
  planProvisioningAction,
  type ConnectorDispatcher,
  type ConnectorProtocol,
} from "@smp/connectors";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "./schema.js";

type Executor = Pick<NodePgDatabase<typeof schema>, "execute">;

type RequestWire = {
  readonly accountMode: "automated" | "orchestration";
  readonly canDeprovision: boolean;
  readonly canProvision: boolean;
  readonly companyId: string;
  readonly licenseTypeId: string;
  readonly licenseTypeName: string;
  readonly personEmail: string;
  readonly personId: string;
  readonly provisioningProtocol: ConnectorProtocol;
  readonly requestId: string;
  readonly requestState: string;
  readonly vendorAccountId: string;
};

export function ecuadorOperatingDate(value: Date): string {
  return new Date(value.getTime() - 18_000_000).toISOString().slice(0, 10);
}

export async function lockCapacityPool(
  executor: Executor,
  vendorAccountId: string,
  licenseTypeId: string,
): Promise<void> {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${`capacity-pool:${vendorAccountId}:${licenseTypeId}`},0))`,
  );
}

export async function lockRequestCapacityPool(
  executor: Executor,
  requestId: string,
  companyIds: "all" | readonly string[],
  notFoundError = "PROVISIONING_REQUEST_NOT_FOUND",
): Promise<{ readonly licenseTypeId: string; readonly vendorAccountId: string }> {
  const companyScope = companyIds === "all"
    ? sql`TRUE`
    : companyIds.length === 0
      ? sql`FALSE`
      : sql`company_id IN (${sql.join(
          companyIds.map((companyId) => sql`${companyId}::uuid`),
          sql`,`,
        )})`;
  const located = await executor.execute<{
    readonly licenseTypeId: string;
    readonly vendorAccountId: string;
  }>(sql`SELECT vendor_account_id::text AS "vendorAccountId",
               license_type_id::text AS "licenseTypeId"
        FROM license_request WHERE id=${requestId}::uuid AND ${companyScope}`);
  const pool = located.rows[0];
  if (!pool) throw new Error(notFoundError);
  await lockCapacityPool(
    executor,
    pool.vendorAccountId,
    pool.licenseTypeId,
  );
  return pool;
}

export async function routeProvisioningActionInTransaction(
  executor: Executor,
  input: {
    readonly actorUserId: string | null;
    readonly expectedState: "approved" | "blocked_no_seat";
    readonly note: string;
    readonly occurredAt: Date;
    readonly requestId: string;
  },
  dispatcher: ConnectorDispatcher = createConnectorDispatcher(),
) {
  const result = await executor.execute<RequestWire>(
    sql`SELECT request.id::text AS "requestId",request.state::text AS "requestState",
               request.company_id::text AS "companyId",request.person_id::text AS "personId",
               request.vendor_account_id::text AS "vendorAccountId",
               request.license_type_id::text AS "licenseTypeId",holder.email AS "personEmail",
               license.name AS "licenseTypeName",account.mode::text AS "accountMode",
               vendor.provisioning_protocol::text AS "provisioningProtocol",
               vendor.can_provision AS "canProvision",vendor.can_deprovision AS "canDeprovision"
        FROM license_request request
        JOIN person holder ON holder.id=request.person_id AND holder.company_id=request.company_id
        JOIN vendor_account account ON account.id=request.vendor_account_id AND account.status='active'
        JOIN vendor ON vendor.id=account.vendor_id
        JOIN license_type license ON license.id=request.license_type_id
          AND license.vendor_id=vendor.id AND license.status='active'
        WHERE request.id=${input.requestId}::uuid FOR UPDATE OF request`,
  );
  const request = result.rows[0];
  if (!request) throw new Error("PROVISIONING_REQUEST_NOT_FOUND");
  const existing = await executor.execute<{
    readonly id: string;
    readonly kind: "checklist" | "invite";
    readonly mode: "automated" | "orchestration";
    readonly rawRequest: unknown;
    readonly status: "pending" | "sent" | "confirmed" | "failed" | "verification_failed";
  }>(sql`SELECT id::text,kind::text,mode::text,status::text,raw_request AS "rawRequest"
          FROM provisioning_action WHERE request_id=${input.requestId}::uuid
            AND raw_request->>'operation'='provision'
            AND ((kind='checklist' AND mode='orchestration') OR
                 (kind='invite' AND mode='automated'))
          ORDER BY created_at,id FOR UPDATE`);
  if (existing.rows[0]) return existing.rows[0];
  if (request.requestState !== input.expectedState) {
    throw new Error(`PROVISIONING_REQUEST_STATE_CONFLICT:${request.requestState}`);
  }
  const plan = await planProvisioningAction(dispatcher, {
    accountMode: request.accountMode,
    context: { companyId: request.companyId, requestId: request.requestId },
    entityIds: { licenseId: request.licenseTypeId, personId: request.personId },
    instruction: {
      licenseTypeName: request.licenseTypeName,
      personEmail: request.personEmail,
      requestId: request.requestId,
      vendorAccountId: request.vendorAccountId,
    },
    operation: "provision",
    vendor: {
      canDeprovision: request.canDeprovision,
      canProvision: request.canProvision,
      provisioningProtocol: request.provisioningProtocol,
    },
  });
  const transitionNote = input.expectedState === "approved"
    ? plan.kind === "checklist"
      ? "Orchestration checklist issued"
      : "Automated provisioning action issued"
    : input.note;
  const actionId = randomUUID();
  await executor.execute(sql`INSERT INTO provisioning_action
      (id,request_id,vendor_account_id,kind,mode,status,raw_request,created_at)
    VALUES (${actionId}::uuid,${request.requestId}::uuid,${request.vendorAccountId}::uuid,
      ${plan.kind}::provisioning_action_kind_enum,${plan.mode}::provisioning_action_mode_enum,
      'pending',${JSON.stringify(plan.rawRequest)}::jsonb,${input.occurredAt})`);
  const updated = await executor.execute<{ readonly id: string }>(
    sql`UPDATE license_request SET state='provisioning',updated_at=${input.occurredAt}
        WHERE id=${request.requestId}::uuid AND company_id=${request.companyId}::uuid
          AND state=${input.expectedState}::license_request_state_enum RETURNING id::text`,
  );
  if (updated.rows.length !== 1) throw new Error("PROVISIONING_REQUEST_UPDATE_CONFLICT");
  await executor.execute(sql`INSERT INTO request_transition
      (request_id,from_state,to_state,actor_user_id,note,occurred_at)
    VALUES (${request.requestId}::uuid,${input.expectedState},'provisioning',
      ${input.actorUserId}::uuid,${transitionNote},${input.occurredAt})`);
  await executor.execute(sql`INSERT INTO audit_log
      (actor_user_id,action,entity_type,entity_id,company_id,note,before,after,occurred_at)
    VALUES (${input.actorUserId}::uuid,'request.provisioning','LicenseRequest',
      ${request.requestId}::uuid,${request.companyId}::uuid,${transitionNote},
      ${JSON.stringify({ state: input.expectedState })}::jsonb,
      '{"state":"provisioning"}'::jsonb,${input.occurredAt})`);
  await executor.execute(sql`INSERT INTO audit_log
      (actor_user_id,action,entity_type,entity_id,company_id,note,before,after,occurred_at)
    VALUES (${input.actorUserId}::uuid,
      ${plan.kind === "checklist" ? "orchestration.checklist_issued" : "orchestration.automated_action_issued"},
      'ProvisioningAction',${actionId}::uuid,${request.companyId}::uuid,NULL,NULL,
      ${JSON.stringify({ kind: plan.kind,mode: plan.mode,requestId: request.requestId,status: "pending" })}::jsonb,
      ${input.occurredAt})`);
  return { id: actionId,kind: plan.kind,mode: plan.mode,rawRequest: plan.rawRequest,status: "pending" as const };
}
