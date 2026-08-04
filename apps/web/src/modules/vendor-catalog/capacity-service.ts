import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  capacityChangeSchema,
  type CapacityChangeInput,
} from "@smp/contracts/capacity";
// eslint-disable-next-line no-restricted-imports -- This service owns the audited capacity transaction.
import * as schema from "@smp/db/schema";
// eslint-disable-next-line no-restricted-imports -- Capacity writes share the canonical transaction-level pool lock.
import { lockCapacityPool } from "@smp/db/provisioning-routing";

import { withAudit } from "../audit/with-audit";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { enqueueCapacityRecovery } from "./capacity-recovery-outbox";
import { observeNoSeatInTransaction } from "./no-seat-observation";

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
      const occurredAt = now();
      await database.transaction(async (transaction) => {
        await observeNoSeatInTransaction(transaction, input, occurredAt);
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
          await lockCapacityPool(
            transaction,
            command.vendorAccountId,
            command.licenseTypeId,
          );
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
