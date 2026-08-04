// eslint-disable-next-line no-restricted-imports -- This repository owns the canonical pool data-access boundary.
import { listCurrentSeatPoolCounts } from "@smp/db/pool-snapshots";
import {
  businessDaysBetween,
  ecuadorOperatingDate,
} from "@smp/domain/jobs/schedule";
import { calculatePool } from "@smp/domain/vendor-catalog/pool-math";
import type { CapacityDecisionEvidence } from "@smp/contracts/capacity";
import pg from "pg";
import { z } from "zod";

import type { LedgerAuthorization } from "../identity-access/authorization";

export type VendorPoolSnapshot = Awaited<
  ReturnType<typeof listCurrentSeatPoolCounts>
>[number] & {
  readonly blockedRequests: readonly {
    readonly businessDaysBlocked: number;
    readonly escalated: boolean;
    readonly id: string;
    readonly requestNo: string;
  }[];
  readonly decisionEvidence: CapacityDecisionEvidence;
  readonly free: number;
  readonly isLow: boolean;
};

function assertPoolAccess(authorization: LedgerAuthorization): void {
  if (authorization.globalRole !== "group_admin") {
    throw new Error("POOL_ACCESS_FORBIDDEN");
  }
}

export function poolOperatingDate(at: Date): string {
  return ecuadorOperatingDate(at);
}

export function parseVendorAccountId(value: string): string | null {
  const result = z.string().uuid().safeParse(value);
  return result.success ? result.data : null;
}

export function createPoolRepository(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return {
    async close(): Promise<void> {
      await pool.end();
    },

    async listSnapshots(
      authorization: LedgerAuthorization,
      at: Date,
      vendorAccountId?: string,
    ): Promise<VendorPoolSnapshot[]> {
      assertPoolAccess(authorization);
      const snapshots = await listCurrentSeatPoolCounts(pool, {
        asOf: at,
        operatingDate: poolOperatingDate(at),
        vendorAccountId,
      });
      const blocked = authorization.companyIds.length
        ? await pool.query<{
            readonly blocked_at: Date;
            readonly id: string;
            readonly license_type_id: string;
            readonly request_no: string;
            readonly vendor_account_id: string;
          }>(
            `SELECT request.id::text, request.request_no,
                    request.vendor_account_id::text,
                    request.license_type_id::text,
                    blocked.occurred_at AS blocked_at
             FROM license_request request
             JOIN person holder
               ON holder.id = request.person_id
              AND holder.company_id = request.company_id
             JOIN LATERAL (
               SELECT transition.occurred_at
               FROM request_transition transition
               WHERE transition.request_id = request.id
                 AND transition.to_state = 'blocked_no_seat'
               ORDER BY transition.occurred_at DESC, transition.id DESC
               LIMIT 1
             ) blocked ON TRUE
             WHERE request.state = 'blocked_no_seat'
               AND request.company_id = ANY($1::uuid[])
               AND ($2::uuid IS NULL OR request.vendor_account_id = $2)`,
            [authorization.companyIds, vendorAccountId ?? null],
          )
        : { rows: [] };
      const holidays = new Set(
        (process.env.ECUADOR_HOLIDAYS ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      const candidates = authorization.companyIds.length
        ? await pool.query<{
            assignment_id: string;
            last_active_on: string;
            license_type_id: string;
            monthly_cost_usd: number;
            vendor_account_id: string;
          }>(
            `SELECT assignment.id::text AS assignment_id,
                    assignment.vendor_account_id::text, assignment.license_type_id::text,
                    max(activity.activity_date)::text AS last_active_on,
                    coalesce(cost.monthly_cost_usd,
                             rate.monthly_rate_usd::float8) AS monthly_cost_usd
             FROM license_assignment assignment
             JOIN person holder ON holder.id=assignment.person_id
               AND holder.company_id=assignment.company_id
             JOIN activity_record activity ON activity.person_id=assignment.person_id
               AND activity.vendor_account_id=assignment.vendor_account_id
             LEFT JOIN LATERAL (
               SELECT sum(amount_usd)::float8 AS monthly_cost_usd
               FROM cost_record
               WHERE person_id=assignment.person_id
                 AND vendor_account_id=assignment.vendor_account_id
                 AND cost_date >= date_trunc('month',$2::date)::date
                 AND cost_date <= $2::date
             ) cost ON TRUE
             LEFT JOIN LATERAL (
               SELECT monthly_rate_usd FROM rate_card
               WHERE vendor_account_id=assignment.vendor_account_id
                 AND license_type_id=assignment.license_type_id
                 AND effective_from <= $2::date
                 AND (effective_to IS NULL OR effective_to >= $2::date)
               ORDER BY effective_from DESC,id DESC LIMIT 1
             ) rate ON TRUE
             WHERE assignment.company_id=ANY($1::uuid[])
               AND assignment.started_on <= $2::date
               AND (assignment.ended_on IS NULL OR assignment.ended_on >= $2::date)
               AND coalesce(cost.monthly_cost_usd,rate.monthly_rate_usd::float8) > 0
             GROUP BY assignment.id,cost.monthly_cost_usd,rate.monthly_rate_usd
             HAVING max(activity.activity_date) < $2::date - 30`,
            [authorization.companyIds, poolOperatingDate(at)],
          )
        : { rows: [] };
      return snapshots.map((snapshot) => {
        const calculated = calculatePool(snapshot);
        const blockedRequests = blocked.rows
          .filter(
            (request) =>
              request.vendor_account_id === snapshot.vendorAccountId &&
              request.license_type_id === snapshot.licenseTypeId,
          )
          .map((request) => {
            const businessDaysBlocked = businessDaysBetween(
              request.blocked_at,
              at,
              { holidays },
            );
            return {
              businessDaysBlocked,
              escalated: businessDaysBlocked > 1,
              id: request.id,
              requestNo: request.request_no,
            };
          });
        const evidenceItems = candidates.rows
          .filter((candidate) =>
            candidate.vendor_account_id === snapshot.vendorAccountId &&
            candidate.license_type_id === snapshot.licenseTypeId,
          )
          .map((candidate) => ({
            assignmentId: candidate.assignment_id,
            lastActiveOn: candidate.last_active_on,
            monthlyCostUsd: candidate.monthly_cost_usd,
          }));
        return {
          ...snapshot,
          ...calculated,
          blockedRequests,
          decisionEvidence: evidenceItems.length
            ? ({ type: "candidates", items: evidenceItems } as const)
            : ({ type: "no_data" } as const),
          isLow: calculated.free < snapshot.lowPoolFloor,
        };
      });
    },
  };
}

export type PoolRepository = ReturnType<typeof createPoolRepository>;
