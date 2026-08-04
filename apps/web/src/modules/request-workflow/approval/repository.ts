import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { decideRequestSchema, type DecideRequestInput } from "@smp/contracts";
import { db } from "@smp/db";
import * as schema from "@smp/db/schema";
import { lockRequestCapacityPool } from "@smp/db/provisioning-routing";
import {
  businessHoursPending,
  hasDecisionTargetBreach,
  type CoveredEcuadorBusinessCalendar,
} from "@smp/domain/request-workflow/business-time";
import { permittedCompanyIds } from "@smp/domain/identity-access";
import type { ConnectorDispatcher } from "@smp/connectors";

import type { LedgerAuthorization } from "../../identity-access/authorization";
import { createLifecycleNotificationDispatcher } from "../lifecycle-notifications";
import { routeApprovedRequestInTransaction } from "../orchestration";
import { applyLockedRequestTransition } from "../transition-core";
import { subtractUsd } from "./money";
import { parseApprovalTimestamp } from "./timestamp";

type Database = NodePgDatabase<typeof schema>;

interface ApprovalWire extends Record<string, unknown> {
  readonly requestId: string;
  readonly requestNo: string;
  readonly requesterName: string;
  readonly requesterEmail: string;
  readonly state: "pending_approval";
  readonly companyName: string;
  readonly companyBudgetUsd: string | null;
  readonly committedRunRateUsd: string | null;
  readonly unpricedCommitmentCount: number;
  readonly licenseTypeName: string;
  readonly vendorAccountName: string;
  readonly justification: string;
  readonly neededBy: string | null;
  readonly createdAt: Date | string;
  readonly monthlyRateUsd: string | null;
}

export interface ApprovalQueueItem {
  readonly requestId: string;
  readonly requestNo: string;
  readonly requesterName: string;
  readonly requesterEmail: string;
  readonly state: "pending_approval";
  readonly companyName: string;
  readonly licenseTypeName: string;
  readonly vendorAccountName: string;
  readonly justification: string;
  readonly neededBy: string | null;
  readonly createdAt: Date;
  readonly monthlyRateUsd: number | null;
  readonly budgetMonthlyUsd: number | null;
  readonly committedRunRateUsd: number | null;
  readonly hasUnpricedCommitments: boolean;
  readonly budgetHeadroomUsd: number | null;
  readonly projectedHeadroomUsd: number | null;
  readonly businessHoursPending: number;
  readonly decisionTargetBreached: boolean;
}

function approvalScope(authorization: LedgerAuthorization) {
  const permitted = permittedCompanyIds(authorization, "request:approve");
  if (permitted === "all") return sql`TRUE`;
  if (permitted.size === 0) return sql`FALSE`;
  return sql`lr.company_id IN (${sql.join(
    [...permitted].map((companyId) => sql`${companyId}::uuid`),
    sql`, `,
  )})`;
}

export function createApprovalRepository(
  database: Database,
  {
    dispatcher,
    lifecycleDispatcher,
  }: {
    readonly dispatcher?: ConnectorDispatcher;
    readonly lifecycleDispatcher?: ReturnType<
      typeof createLifecycleNotificationDispatcher
    >;
  } = {},
) {
  return {
    async decisionCompanyIdForAudit(
      requestId: string,
    ): Promise<string | null> {
      const [request] = await database
        .select({ companyId: schema.licenseRequest.companyId })
        .from(schema.licenseRequest)
        .where(eq(schema.licenseRequest.id, requestId))
        .limit(1);
      return request?.companyId ?? null;
    },

    async listPending(
      authorization: LedgerAuthorization,
      now: Date,
      calendar: CoveredEcuadorBusinessCalendar,
    ): Promise<ApprovalQueueItem[]> {
      // Stryker disable next-line MethodExpression: @equivalent PostgreSQL casts
      // either this ISO date or its full ISO timestamp to the same date.
      const rateDate = now.toISOString().slice(0, 10);
      const result = await database.execute<ApprovalWire>(
        sql`SELECT lr.id::text AS "requestId",
                   lr.request_no AS "requestNo",
                   p.full_name AS "requesterName",
                   p.email AS "requesterEmail",
                   lr.state AS state,
                   c.name AS "companyName",
                   c.budget_monthly_usd::text AS "companyBudgetUsd",
                   committed.committed_run_rate_usd::text AS "committedRunRateUsd",
                   committed.unpriced_commitment_count::int AS "unpricedCommitmentCount",
                   lt.name AS "licenseTypeName",
                   va.name AS "vendorAccountName",
                   lr.justification,
                   lr.needed_by::text AS "neededBy",
                   lr.created_at AS "createdAt",
                   current_rate.monthly_rate_usd::text AS "monthlyRateUsd"
            FROM license_request lr
            JOIN person p
              ON p.id = lr.person_id
             AND p.company_id = lr.company_id
            JOIN company c ON c.id = lr.company_id
            JOIN vendor_account va ON va.id = lr.vendor_account_id
            JOIN license_type lt
              ON lt.id = lr.license_type_id
             AND lt.vendor_id = va.vendor_id
            LEFT JOIN LATERAL (
              SELECT CASE
                       WHEN COUNT(*) FILTER (
                         WHERE assignment_rate.monthly_rate_usd IS NULL
                       ) > 0 THEN NULL
                       ELSE COALESCE(SUM(assignment_rate.monthly_rate_usd), 0)
                     END AS committed_run_rate_usd,
                     COUNT(*) FILTER (
                       WHERE assignment_rate.monthly_rate_usd IS NULL
                     ) AS unpriced_commitment_count
              FROM license_assignment la
              JOIN person assigned_person
                ON assigned_person.id = la.person_id
               AND assigned_person.company_id = la.company_id
              LEFT JOIN LATERAL (
                SELECT rc.monthly_rate_usd
                FROM rate_card rc
                WHERE rc.vendor_account_id = la.vendor_account_id
                  AND rc.license_type_id = la.license_type_id
                  AND rc.effective_from <= ${rateDate}::date
                  AND (rc.effective_to IS NULL OR rc.effective_to >= ${rateDate}::date)
                ORDER BY rc.effective_from DESC, rc.created_at DESC, rc.id DESC
                LIMIT 1
              ) assignment_rate ON TRUE
              WHERE la.company_id = lr.company_id
                AND la.started_on <= ${rateDate}::date
                AND (la.ended_on IS NULL OR la.ended_on >= ${rateDate}::date)
            ) committed ON TRUE
            LEFT JOIN LATERAL (
              SELECT rc.monthly_rate_usd
              FROM rate_card rc
              WHERE rc.vendor_account_id = lr.vendor_account_id
                AND rc.license_type_id = lr.license_type_id
                AND rc.effective_from <= ${rateDate}::date
                AND (rc.effective_to IS NULL OR rc.effective_to >= ${rateDate}::date)
              ORDER BY rc.effective_from DESC, rc.created_at DESC, rc.id DESC
              LIMIT 1
            ) current_rate ON TRUE
            WHERE lr.state = 'pending_approval'
              AND ${approvalScope(authorization)}
            ORDER BY lr.created_at ASC, lr.id ASC`,
      );

      return result.rows.map((row) => {
        const createdAt = parseApprovalTimestamp(row.createdAt);
        const monthlyRateUsd =
          row.monthlyRateUsd === null ? null : Number(row.monthlyRateUsd);
        const budget =
          row.companyBudgetUsd === null ? null : Number(row.companyBudgetUsd);
        const hasUnpricedCommitments = row.unpricedCommitmentCount > 0;
        const committedRunRateUsd =
          row.committedRunRateUsd === null
            ? null
            : Number(row.committedRunRateUsd);
        const budgetHeadroomUsd =
          budget === null || committedRunRateUsd === null
            ? null
            : subtractUsd(budget, committedRunRateUsd);
        const pendingHours = businessHoursPending(
          createdAt,
          now,
          calendar,
        );
        return {
          ...row,
          createdAt,
          monthlyRateUsd,
          budgetMonthlyUsd: budget,
          committedRunRateUsd,
          hasUnpricedCommitments,
          budgetHeadroomUsd,
          projectedHeadroomUsd:
            budgetHeadroomUsd === null || monthlyRateUsd === null
              ? null
              : subtractUsd(budgetHeadroomUsd, monthlyRateUsd),
          businessHoursPending: pendingHours,
          decisionTargetBreached: hasDecisionTargetBreach(
            pendingHours,
            48,
          ),
        };
      });
    },

    async decide(
      authorization: LedgerAuthorization,
      untrustedInput: DecideRequestInput,
      occurredAt: Date,
    ): Promise<void> {
      const input = decideRequestSchema.parse(untrustedInput);
      await database.transaction(async (transaction) => {
        if (input.decision === "approved") {
          const permitted = permittedCompanyIds(
            authorization,
            "request:approve",
          );
          await lockRequestCapacityPool(
            transaction,
            input.requestId,
            permitted === "all" ? "all" : [...permitted],
            `REQUEST_NOT_FOUND:${input.requestId}`,
          );
        }
        await applyLockedRequestTransition(transaction, authorization, {
          requestId: input.requestId,
          from: "pending_approval",
          to: input.decision,
          actorUserId: authorization.userAccountId,
          note: input.decisionComment ?? null,
          occurredAt,
        });
        if (input.decision === "approved") {
          await routeApprovedRequestInTransaction(
            transaction,
            authorization,
            input.requestId,
            occurredAt,
            dispatcher,
          );
        }
      });
      await lifecycleDispatcher
        ?.dispatchRequest(input.requestId)
        .catch(() => undefined);
    },
  };
}

export type ApprovalRepository = ReturnType<typeof createApprovalRepository>;

export function createProductionApprovalRepository(database: Database) {
  return createApprovalRepository(database, {
    lifecycleDispatcher: createLifecycleNotificationDispatcher(
      database,
      { workerId: "web-approval-decision" },
    ),
  });
}

const productionDatabase = db as unknown as Database;
export const approvalRepository =
  createProductionApprovalRepository(productionDatabase);
