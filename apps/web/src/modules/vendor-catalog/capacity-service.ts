import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import {
  capacityChangeSchema,
  type CapacityChangeInput,
} from "@smp/contracts/capacity";
// eslint-disable-next-line no-restricted-imports -- The trusted observation transaction records the canonical system actor.
import { SYSTEM_USER_ID } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- This service owns the audited capacity transaction.
import * as schema from "@smp/db/schema";

import { withAudit } from "../audit/with-audit";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { enqueueCapacityRecovery } from "./capacity-recovery-outbox";

type Database = NodePgDatabase<typeof schema>;

export interface CapacityChangeResult extends CapacityChangeInput {
  readonly id: string;
  readonly createdAt: string;
}

function assertCapacityAccess(authorization: LedgerAuthorization): void {
  if (authorization.globalRole !== "group_admin") {
    throw new Error("CAPACITY_ACCESS_FORBIDDEN");
  }
}

function parseInput(input: unknown): CapacityChangeInput {
  const parsed = capacityChangeSchema.safeParse(input);
  if (!parsed.success) throw new Error("CAPACITY_INPUT_INVALID");
  return parsed.data;
}

export function createCapacityService(
  database: Database,
  options: {
    readonly now?: () => Date;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  return {
    /** Trusted provisioning/pool observation seam; no request-supplied tenant scope. */
    async observeNoSeat(input: unknown): Promise<void> {
      const parsed = z
        .object({
          requestId: z.string().uuid(),
          source: z.enum(["pool_empty", "provider_400"]),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new Error("CAPACITY_INPUT_INVALID");
      const occurredAt = now();
      await database.transaction(async (transaction) => {
        const locked = await transaction.execute<{
          readonly companyId: string;
          readonly state: "approved" | "blocked_no_seat";
        }>(
          sql`SELECT company_id::text AS "companyId", state::text AS state
              FROM license_request
              WHERE id = ${parsed.data.requestId}::uuid
                AND state IN ('approved','blocked_no_seat')
              FOR UPDATE`,
        );
        const request = locked.rows[0];
        if (!request) throw new Error("CAPACITY_REQUEST_NOT_FOUND");
        if (request.state === "blocked_no_seat") return;
        await transaction.execute(
          sql`UPDATE license_request
              SET state = 'blocked_no_seat', updated_at = ${occurredAt}
              WHERE id = ${parsed.data.requestId}::uuid
                AND company_id = ${request.companyId}::uuid
                AND state = 'approved'`,
        );
        await transaction.execute(
          sql`INSERT INTO request_transition
                (request_id,from_state,to_state,actor_user_id,note,occurred_at)
              VALUES (${parsed.data.requestId}::uuid,'approved','blocked_no_seat',
                      ${SYSTEM_USER_ID}::uuid,
                      ${parsed.data.source},${occurredAt})`,
        );
        await transaction.execute(
          sql`INSERT INTO audit_log
                (actor_user_id,action,entity_type,entity_id,company_id,note,
                 before,after,occurred_at)
              VALUES (${SYSTEM_USER_ID}::uuid,
                      'request.blocked_no_seat','LicenseRequest',
                      ${parsed.data.requestId}::uuid,${request.companyId}::uuid,
                      ${parsed.data.source},'{"state":"approved"}'::jsonb,
                      '{"state":"blocked_no_seat"}'::jsonb,${occurredAt})`,
        );
        const event = await transaction.execute<{ readonly id: string }>(
          sql`INSERT INTO alert_event
                (alert_rule_id,fired_at,subject_ref,notified,dedupe_key)
              SELECT rule.id,${occurredAt},
                     ${JSON.stringify({ requestId: parsed.data.requestId })}::jsonb,
                     '{"status":"pending"}'::jsonb,
                     rule.id::text || ':blocked:' || ${parsed.data.requestId}
              FROM alert_rule rule
              WHERE rule.type = 'blocked_no_seat'
                AND rule.enabled
                AND (rule.scope_kind = 'global'
                  OR (rule.scope_kind = 'company'
                      AND rule.company_id = ${request.companyId}::uuid))
              ORDER BY CASE rule.scope_kind WHEN 'company' THEN 0 ELSE 1 END
              LIMIT 1
              ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
              RETURNING id::text AS id`,
        );
        const eventId = event.rows[0]?.id;
        if (!eventId) return;
        const recipients = await transaction.execute<{
          readonly email: string;
          readonly id: string;
          readonly locale: "en" | "es";
        }>(
          sql`SELECT DISTINCT ON (recipient.id)
                     recipient.id::text AS id, recipient.email,
                     recipient.ui_language::text AS locale
              FROM license_request request
              JOIN user_account recipient
                ON recipient.status = 'active'
               AND (recipient.id = request.requested_by
                    OR recipient.global_role = 'group_admin')
              WHERE request.id = ${parsed.data.requestId}::uuid
                AND request.company_id = ${request.companyId}::uuid
              ORDER BY recipient.id`,
        );
        for (const recipient of recipients.rows) {
          await transaction.execute(
            sql`SELECT append_alert_recipient_pending(
                  ${eventId}::uuid, ${`user:${recipient.id}`},
                  ${recipient.id}::uuid, ${recipient.email},
                  ${recipient.locale}::user_account_ui_language_enum,
                  ${occurredAt})`,
          );
        }
      });
    },

    async changeCapacity(
      authorization: LedgerAuthorization,
      input: unknown,
    ): Promise<CapacityChangeResult> {
      return await withAudit(
        database,
        async (transaction) => {
          assertCapacityAccess(authorization);
          const command = parseInput(input);
          const occurredAt = now();
          const ownership = await transaction.execute<{ readonly valid: boolean }>(
            sql`SELECT (license.vendor_id = account.vendor_id) AS valid
                FROM vendor_account account
                JOIN license_type license
                  ON license.id = ${command.licenseTypeId}::uuid
                WHERE account.id = ${command.vendorAccountId}::uuid
                  AND account.status = 'active'
                  AND license.status = 'active'
                FOR UPDATE OF account`,
          );
          if (!ownership.rows[0]?.valid) {
            throw new Error("CAPACITY_LICENSE_VENDOR_MISMATCH");
          }
          const existing = await transaction.execute<{ readonly id: string }>(
            sql`SELECT id::text AS id
                FROM vendor_account_capacity
                WHERE vendor_account_id = ${command.vendorAccountId}::uuid
                  AND license_type_id = ${command.licenseTypeId}::uuid
                  AND effective_from = ${command.effectiveFrom}::date
                LIMIT 1`,
          );
          if (existing.rows.length > 0) {
            throw new Error("CAPACITY_EFFECTIVE_DATE_CONFLICT");
          }
          const inserted = await transaction.execute<{
            readonly createdAt: Date | string;
            readonly id: string;
          }>(
            sql`INSERT INTO vendor_account_capacity
                  (vendor_account_id, license_type_id, purchased_qty,
                   effective_from, note, created_at, created_by)
                VALUES (${command.vendorAccountId}::uuid,
                        ${command.licenseTypeId}::uuid,
                        ${command.purchasedQty}, ${command.effectiveFrom}::date,
                        ${command.note ?? null}, ${occurredAt},
                        ${authorization.userAccountId}::uuid)
                RETURNING id::text AS id, created_at AS "createdAt"`,
          );
          const row = inserted.rows[0]!;
          const value: CapacityChangeResult = {
            ...command,
            createdAt:
              row.createdAt instanceof Date
                ? row.createdAt.toISOString()
                : new Date(row.createdAt).toISOString(),
            id: row.id,
          };
          await enqueueCapacityRecovery(transaction, {
            capacityId: row.id,
            effectiveFrom: command.effectiveFrom,
            licenseTypeId: command.licenseTypeId,
            occurredAt,
            source: "capacity_change",
            vendorAccountId: command.vendorAccountId,
          });
          return {
            value,
            audit: {
              actorUserId: authorization.userAccountId,
              action: "capacity.changed",
              entityType: "VendorAccountCapacity",
              entityId: row.id,
              companyId: null,
              note: command.note ?? command.reason,
              before: null,
              after: value,
            },
          };
        },
      );
    },
  };
}

export type CapacityService = ReturnType<typeof createCapacityService>;
