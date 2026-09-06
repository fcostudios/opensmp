import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { provisioningAction, vendorAccount } from "./schema";

export const connector_call_operation_enum = pgEnum(
  "connector_call_operation_enum",
  ["provision", "deprovision", "sync_members", "sync_activity", "sync_cost"],
);
export const connector_call_phase_enum = pgEnum(
  "connector_call_phase_enum",
  ["requested", "succeeded", "failed"],
);

export const connectorCallObservation = pgTable("connector_call_observation", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  vendorAccountId: uuid("vendor_account_id")
    .references(() => vendorAccount.id)
    .notNull(),
  provisioningActionId: uuid("provisioning_action_id")
    .references(() => provisioningAction.id),
  correlationId: uuid("correlation_id").notNull(),
  operation: connector_call_operation_enum("operation").notNull(),
  attempt: integer("attempt").notNull(),
  phase: connector_call_phase_enum("phase").notNull(),
  classification: text("classification"),
  summary: jsonb("summary").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({
  attemptCheck: check(
    "connector_call_attempt_check",
    sql`${table.attempt} >= 1`,
  ),
  summaryCheck: check(
    "connector_call_summary_check",
    sql`jsonb_typeof(${table.summary}) = 'object'`,
  ),
  classificationCheck: check("connector_call_classification_check", sql`
    (${table.phase} = 'requested' AND ${table.classification} IS NULL)
    OR (${table.phase} = 'succeeded' AND ${table.classification} IS NOT NULL AND ${table.classification} = 'success')
    OR (${table.phase} = 'failed' AND ${table.classification} IS NOT NULL AND ${table.classification} IN ('rate_limited', 'provider_error', 'client_error'))`),
  syncActionCheck: check(
    "connector_call_sync_action_check",
    sql`${table.operation} IN ('provision', 'deprovision') OR ${table.provisioningActionId} IS NULL`,
  ),
  phaseUnique: unique("uq_connector_call_phase")
    .on(table.correlationId, table.attempt, table.phase),
  terminalUnique: uniqueIndex("uq_connector_call_terminal")
    .on(table.correlationId, table.attempt)
    .where(sql`${table.phase} IN ('succeeded', 'failed')`),
  vendorAccountIndex: index("idx_connector_call_vendor_account")
    .on(table.vendorAccountId),
  actionIndex: index("idx_connector_call_action")
    .on(table.provisioningActionId),
  correlationIndex: index("idx_connector_call_correlation")
    .on(table.correlationId),
  operationIndex: index("idx_connector_call_operation").on(table.operation),
  occurredAtIndex: index("idx_connector_call_occurred_at").on(table.occurredAt),
}));
