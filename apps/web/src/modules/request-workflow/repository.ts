import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import {
  submitRequestSchema,
  type SubmitRequestInput,
} from "@smp/contracts";
import { db } from "@smp/db";
import * as schema from "@smp/db/schema";
import { permittedCompanyIds } from "@smp/domain/identity-access";
import { assertLegalTransition } from "@smp/domain/request-workflow";

import {
  assertCapability,
  type LedgerAuthorization,
} from "../identity-access/authorization";
import { calculateBudgetProjectionCents } from "./budget-math";
import {
  createLifecycleNotificationDispatcher,
  enqueueLifecyclePendingApproval,
} from "./lifecycle-notifications";
import { createRequestReadRepository } from "./read-repository";

export type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type RequestState = typeof schema.licenseRequest.$inferSelect.state;
export type RequestActionKind =
  typeof schema.provisioningAction.$inferSelect.kind;
export type RequestActionMode =
  typeof schema.provisioningAction.$inferSelect.mode;
export type RequestActionStatus =
  typeof schema.provisioningAction.$inferSelect.status;
export type RequestAssignmentEndReason =
  typeof schema.licenseAssignment.$inferSelect.endReason;

export type RequestWarning =
  | { readonly code: "unknown_email_domain" }
  | { readonly code: "missing_rate" }
  | {
      readonly code: "budget_headroom";
      readonly budgetMonthlyUsd: number;
      readonly committedRunRateUsd: number;
      readonly monthlyRateUsd: number;
      readonly projectedRunRateUsd: number;
    };

export type RequestIntakeErrorCode =
  | "self_identity_unavailable"
  | "on_behalf_forbidden"
  | "company_inactive"
  | "vendor_account_inactive"
  | "license_type_inactive"
  | "vendor_license_mismatch"
  | "person_email_conflict"
  | "person_inactive"
  | "active_assignment_exists"
  | "idempotency_conflict";

export class RequestIntakeError extends Error {
  constructor(
    readonly code: RequestIntakeErrorCode,
    readonly href?: string,
    readonly companyId?: string,
  ) {
    super(code);
  }
}

interface PersonWire extends Record<string, unknown> {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly companyId: string;
  readonly status: "active" | "departed";
}

interface CatalogWire extends Record<string, unknown> {
  readonly companyStatus: "active" | "inactive";
  readonly budgetMonthlyUsd: string | null;
  readonly vendorAccountStatus: "active" | "inactive";
  readonly vendorStatus: "active" | "inactive";
  readonly vendorId: string;
  readonly licenseVendorId: string;
  readonly licenseTypeStatus: "active" | "inactive";
}

function requestSemanticPayload(input: SubmitRequestInput) {
  const { clientRequestId: _clientRequestId, ...semanticPayload } = input;
  return {
    ...semanticPayload,
    neededBy: semanticPayload.neededBy ?? null,
  };
}

function isPersonEmailConflict(error: unknown): boolean {
  return (error as { readonly code?: string }).code === "23505";
}

function canRequestOnBehalf(
  authorization: LedgerAuthorization,
  companyId: string,
): boolean {
  return (
    authorization.globalRole === "group_admin" ||
    authorization.companyGrants.some(
      (grant) =>
        grant.companyId === companyId && grant.role === "approver",
    )
  );
}

async function resolveSelf(
  transaction: Transaction,
  authorization: LedgerAuthorization,
): Promise<PersonWire> {
  const result = await transaction.execute<PersonWire>(
    sql`SELECT p.id::text AS id, p.email, p.full_name AS "fullName",
               p.company_id::text AS "companyId", p.status
        FROM user_account ua
        JOIN person p ON p.id = ua.person_id
        WHERE ua.id = ${authorization.userAccountId}::uuid
          AND ua.status = 'active'
          AND p.company_id = ${authorization.employeeCompanyId}::uuid`,
  );
  const [person] = result.rows;
  if (!person) throw new RequestIntakeError("self_identity_unavailable");
  return person;
}

async function resolveOnBehalf(
  transaction: Transaction,
  authorization: LedgerAuthorization,
  input: Extract<SubmitRequestInput, { requestFor: "on_behalf" }>,
  occurredAt: Date,
): Promise<PersonWire> {
  if (!canRequestOnBehalf(authorization, input.personCompanyId)) {
    throw new RequestIntakeError(
      "on_behalf_forbidden",
      undefined,
      input.personCompanyId,
    );
  }
  assertCapability(authorization, "request:create", input.personCompanyId);
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${input.personEmail}, 12012)
    )`,
  );
  const existing = await transaction.execute<PersonWire>(
    sql`SELECT id::text AS id, email, full_name AS "fullName",
               company_id::text AS "companyId", status
        FROM person
        WHERE lower(email) = ${input.personEmail}
          AND company_id = ${input.personCompanyId}::uuid
        FOR UPDATE`,
  );
  const [person] = existing.rows;
  if (person) return person;
  try {
    const inserted = await transaction.execute<PersonWire>(
      sql`INSERT INTO person
            (email, full_name, company_id, status, created_at, created_by)
          VALUES
            (${input.personEmail}, ${input.personFullName},
             ${input.personCompanyId}::uuid, 'active', ${occurredAt},
             ${authorization.userAccountId}::uuid)
          RETURNING id::text AS id, email, full_name AS "fullName",
                    company_id::text AS "companyId", status`,
    );
    return inserted.rows[0]!;
  } catch (error) {
    if (isPersonEmailConflict(error)) {
      throw new RequestIntakeError("person_email_conflict");
    }
    throw error;
  }
}

async function validateCatalog(
  transaction: Transaction,
  companyId: string,
  vendorAccountId: string,
  licenseTypeId: string,
): Promise<CatalogWire> {
  const result = await transaction.execute<CatalogWire>(
    sql`SELECT c.status AS "companyStatus",
               c.budget_monthly_usd::text AS "budgetMonthlyUsd",
               va.status AS "vendorAccountStatus",
               v.status AS "vendorStatus",
               va.vendor_id::text AS "vendorId",
               lt.vendor_id::text AS "licenseVendorId",
               lt.status AS "licenseTypeStatus"
        FROM company c
        CROSS JOIN vendor_account va
        JOIN vendor v ON v.id = va.vendor_id
        CROSS JOIN license_type lt
        WHERE c.id = ${companyId}::uuid
          AND va.id = ${vendorAccountId}::uuid
          AND lt.id = ${licenseTypeId}::uuid`,
  );
  const [catalog] = result.rows;
  if (!catalog || catalog.companyStatus !== "active") {
    throw new RequestIntakeError("company_inactive");
  }
  if (
    catalog.vendorAccountStatus !== "active" ||
    catalog.vendorStatus !== "active"
  ) {
    throw new RequestIntakeError("vendor_account_inactive");
  }
  if (catalog.licenseTypeStatus !== "active") {
    throw new RequestIntakeError("license_type_inactive");
  }
  if (catalog.vendorId !== catalog.licenseVendorId) {
    throw new RequestIntakeError("vendor_license_mismatch");
  }
  return catalog;
}

async function rejectDuplicateAssignment(
  transaction: Transaction,
  personId: string,
  companyId: string,
  vendorAccountId: string,
  licenseTypeId: string,
): Promise<void> {
  const duplicate = await transaction.execute<{
    readonly id: string;
    readonly sourceRequestId: string | null;
  }>(
    sql`SELECT id::text AS id,
               source_request_id::text AS "sourceRequestId"
        FROM license_assignment
        WHERE person_id = ${personId}::uuid
          AND company_id = ${companyId}::uuid
          AND vendor_account_id = ${vendorAccountId}::uuid
          AND license_type_id = ${licenseTypeId}::uuid
          AND ended_on IS NULL
        ORDER BY started_on DESC, id DESC
        LIMIT 1`,
  );
  const assignment = duplicate.rows[0];
  if (assignment) {
    throw new RequestIntakeError(
      "active_assignment_exists",
      assignment.sourceRequestId
        ? `/solicitudes/${assignment.sourceRequestId}`
        : `/solicitudes/${assignment.id}`,
    );
  }
}

async function requestWarnings(
  transaction: Transaction,
  personId: string,
  personEmail: string,
  companyId: string,
  vendorAccountId: string,
  licenseTypeId: string,
  catalog: CatalogWire,
  occurredAt: Date,
): Promise<RequestWarning[]> {
  const warnings: RequestWarning[] = [];
  // Stryker disable next-line UnaryOperator: @equivalent: submitRequestSchema guarantees exactly one @, so .at(-1) and .at(+1) select the same sole domain segment.
  const emailDomain = personEmail.split("@").at(-1);
  const knownDomain = await transaction.execute<{ readonly known: boolean }>(
    sql`SELECT EXISTS (
          SELECT 1
          FROM company c
          LEFT JOIN person p
            ON p.company_id = c.id
           AND p.status = 'active'
           AND p.id <> ${personId}::uuid
          WHERE c.id = ${companyId}::uuid
            AND c.status = 'active'
            AND (
              lower(split_part(c.finance_contact_email, '@', 2)) = ${emailDomain}
              OR lower(split_part(p.email, '@', 2)) = ${emailDomain}
            )
        ) AS known`,
  );
  if (!knownDomain.rows[0]!.known) {
    warnings.push({ code: "unknown_email_domain" });
  }

  // Stryker disable next-line MethodExpression: @equivalent: PostgreSQL casts this UTC midnight instant and its YYYY-MM-DD prefix to the same date.
  const rateDate = occurredAt.toISOString().slice(0, 10);
  const rate = await transaction.execute<{
    readonly monthlyRateUsd: string | null;
  }>(
    sql`SELECT monthly_rate_usd::text AS "monthlyRateUsd"
        FROM rate_card
        WHERE vendor_account_id = ${vendorAccountId}::uuid
          AND license_type_id = ${licenseTypeId}::uuid
          AND effective_from <= ${rateDate}::date
          AND (effective_to IS NULL OR effective_to >= ${rateDate}::date)
        ORDER BY effective_from DESC, created_at DESC, id DESC
        LIMIT 1`,
  );
  const monthlyRateUsd = rate.rows[0]?.monthlyRateUsd;
  if (monthlyRateUsd === undefined || monthlyRateUsd === null) {
    warnings.push({ code: "missing_rate" });
    return warnings;
  }
  if (catalog.budgetMonthlyUsd === null) return warnings;

  const committed = await transaction.execute<{
    readonly total: string | null;
    readonly unpriced: number;
  }>(
    sql`SELECT SUM(current_rate.monthly_rate_usd)::text AS total,
               COUNT(*) FILTER (
                 WHERE current_rate.monthly_rate_usd IS NULL
               )::int AS unpriced
        FROM license_assignment la
        LEFT JOIN LATERAL (
          SELECT monthly_rate_usd
          FROM rate_card rc
          WHERE rc.vendor_account_id = la.vendor_account_id
            AND rc.license_type_id = la.license_type_id
            AND rc.effective_from <= ${rateDate}::date
            AND (rc.effective_to IS NULL OR rc.effective_to >= ${rateDate}::date)
          ORDER BY rc.effective_from DESC, rc.created_at DESC, rc.id DESC
          LIMIT 1
        ) current_rate ON TRUE
        WHERE la.company_id = ${companyId}::uuid
          AND la.started_on <= ${rateDate}::date
          AND (la.ended_on IS NULL OR la.ended_on >= ${rateDate}::date)`,
  );
  const runRate = committed.rows[0]!;
  if (runRate.unpriced > 0) return warnings;
  const committedRunRateUsd = runRate.total ?? "0";
  const projection = calculateBudgetProjectionCents({
    budgetMonthlyUsd: catalog.budgetMonthlyUsd,
    committedRunRateUsd,
    monthlyRateUsd,
  });
  const budget = Number(catalog.budgetMonthlyUsd);
  const committedRunRate = Number(committedRunRateUsd);
  const monthlyRate = Number(monthlyRateUsd);
  if (projection.exceedsBudget) {
    warnings.push({
      code: "budget_headroom",
      budgetMonthlyUsd: budget,
      committedRunRateUsd: committedRunRate,
      monthlyRateUsd: monthlyRate,
      projectedRunRateUsd: Number(projection.projectedRunRateCents) / 100,
    });
  }
  return warnings;
}

async function allocateRequestNo(transaction: Transaction): Promise<string> {
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('license-request-sequence', 12012))`,
  );
  const sequence = await transaction.execute<{ readonly next: number }>(
    sql`SELECT COALESCE(
          MAX(substring(request_no FROM '^SOL-([0-9]+)$')::int),
          0
        ) + 1 AS next
        FROM license_request`,
  );
  return `SOL-${String(sequence.rows[0]!.next).padStart(4, "0")}`;
}

type LifecycleDispatcher = ReturnType<
  typeof createLifecycleNotificationDispatcher
>;

export function createRequestRepository(
  database: Database,
  {
    lifecycleDispatcher,
  }: { readonly lifecycleDispatcher?: LifecycleDispatcher } = {},
) {
  return {
    async formOptions(authorization: LedgerAuthorization) {
      const permitted = permittedCompanyIds(authorization, "request:create");
      const companyScope =
        permitted === "all"
          ? sql`TRUE`
          : permitted.size === 0
            ? sql`FALSE`
            : sql`c.id IN (${sql.join(
                [...permitted].map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`;
      const [companies, catalog] = await Promise.all([
        database.execute<{
          readonly id: string;
          readonly name: string;
          readonly domains: string[];
        }>(
          sql`SELECT c.id::text AS id,
                     c.name,
                     COALESCE(
                       array_agg(DISTINCT domain.value ORDER BY domain.value)
                         FILTER (WHERE domain.value <> ''),
                       ARRAY[]::text[]
                     ) AS domains
              FROM company c
              LEFT JOIN LATERAL (
                SELECT lower(split_part(c.finance_contact_email, '@', 2)) AS value
                UNION
                SELECT lower(split_part(p.email, '@', 2)) AS value
                FROM person p
                WHERE p.company_id = c.id
                  AND p.status = 'active'
              ) domain ON TRUE
              WHERE c.status = 'active' AND ${companyScope}
              GROUP BY c.id, c.name
              ORDER BY c.name, c.id`,
        ),
        database.execute<{
          readonly vendorAccountId: string;
          readonly vendorAccountName: string;
          readonly licenseTypeId: string;
          readonly licenseTypeName: string;
        }>(
          sql`SELECT va.id::text AS "vendorAccountId",
                     va.name AS "vendorAccountName",
                     lt.id::text AS "licenseTypeId",
                     lt.name AS "licenseTypeName"
              FROM vendor_account va
              JOIN vendor v
                ON v.id = va.vendor_id
               AND v.status = 'active'
              JOIN license_type lt
                ON lt.vendor_id = va.vendor_id
               AND lt.status = 'active'
              WHERE va.status = 'active'
              ORDER BY va.name, va.id, lt.name, lt.id`,
        ),
      ]);
      const vendorAccounts = new Map<
        string,
        {
          id: string;
          name: string;
          licenseTypes: { id: string; name: string }[];
        }
      >();
      for (const row of catalog.rows) {
        const account = vendorAccounts.get(row.vendorAccountId) ?? {
          id: row.vendorAccountId,
          name: row.vendorAccountName,
          licenseTypes: [],
        };
        account.licenseTypes.push({
          id: row.licenseTypeId,
          name: row.licenseTypeName,
        });
        vendorAccounts.set(row.vendorAccountId, account);
      }
      return {
        allowOnBehalf:
          authorization.globalRole === "group_admin" ||
          authorization.companyGrants.some(
            (grant) => grant.role === "approver",
          ),
        companies: companies.rows,
        vendorAccounts: [...vendorAccounts.values()],
      };
    },

    async requestDetail(
      authorization: LedgerAuthorization,
      requestId: string,
    ) {
      if (!z.string().uuid().safeParse(requestId).success) return null;
      const approvable = permittedCompanyIds(
        authorization,
        "request:approve",
      );
      const approvalScope =
        approvable === "all"
          ? sql`TRUE`
          : approvable.size === 0
            ? sql`FALSE`
            : sql`lr.company_id IN (${sql.join(
                [...approvable].map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`;
      const result = await database.execute<{
        readonly requestId: string;
        readonly requestNo: string;
        readonly companyId: string;
        readonly warnings: RequestWarning[];
      }>(
        sql`SELECT lr.id::text AS "requestId",
                   lr.request_no AS "requestNo",
                   lr.company_id::text AS "companyId",
                   COALESCE(
                     submitted.after->'warnings',
                     '[]'::jsonb
                   ) AS warnings
            FROM license_request lr
            JOIN person p
              ON p.id = lr.person_id
             AND p.company_id = lr.company_id
            LEFT JOIN user_account actor
              ON actor.id = ${authorization.userAccountId}::uuid
            LEFT JOIN audit_log submitted
              ON submitted.entity_type = 'LicenseRequest'
             AND submitted.entity_id = lr.id
             AND submitted.action = 'request.submitted'
            WHERE lr.id = ${requestId}::uuid
              AND (
                lr.requested_by = ${authorization.userAccountId}::uuid
                OR lr.person_id = actor.person_id
                OR ${approvalScope}
              )
            LIMIT 1`,
      );
      const request = result.rows[0];
      if (request) return { kind: "request" as const, ...request };
      const assignmentApprovalScope =
        approvable === "all"
          ? sql`TRUE`
          : approvable.size === 0
            ? sql`FALSE`
            : sql`la.company_id IN (${sql.join(
                [...approvable].map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`;
      const assignment = await database.execute<{
        readonly assignmentId: string;
        readonly companyId: string;
        readonly personId: string;
      }>(
        sql`SELECT la.id::text AS "assignmentId",
                   la.company_id::text AS "companyId",
                   la.person_id::text AS "personId"
            FROM license_assignment la
            JOIN person p
              ON p.id = la.person_id
             AND p.company_id = la.company_id
            LEFT JOIN user_account actor
              ON actor.id = ${authorization.userAccountId}::uuid
            WHERE la.id = ${requestId}::uuid
              AND (
                la.person_id = actor.person_id
                OR ${assignmentApprovalScope}
              )
            LIMIT 1`,
      );
      const imported = assignment.rows[0];
      return imported
        ? { kind: "assignment" as const, ...imported }
        : null;
    },

    async submit(
      authorization: LedgerAuthorization,
      untrustedInput: SubmitRequestInput,
      occurredAt: Date,
    ) {
      const input = submitRequestSchema.parse(untrustedInput);
      const result = await database.transaction(async (transaction) => {
        const clientPayload = requestSemanticPayload(input);
        await transaction.execute(
          sql`SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${`${authorization.userAccountId}:${input.clientRequestId}`},
              12012
            )
          )`,
        );
        const replay = await transaction.execute<{
          readonly requestId: string;
          readonly requestNo: string;
          readonly samePayload: boolean;
          readonly warnings: RequestWarning[];
        }>(
          sql`SELECT lr.id::text AS "requestId",
                     lr.request_no AS "requestNo",
                     submitted.after->'clientPayload' =
                       ${JSON.stringify(clientPayload)}::jsonb AS "samePayload",
                     submitted.after->'warnings' AS warnings
              FROM license_request lr
              LEFT JOIN audit_log submitted
                ON submitted.entity_type = 'LicenseRequest'
               AND submitted.entity_id = lr.id
               AND submitted.action = 'request.submitted'
              WHERE lr.requested_by = ${authorization.userAccountId}::uuid
                AND lr.client_request_id = ${input.clientRequestId}::uuid
              LIMIT 1`,
        );
        const existing = replay.rows[0];
        if (existing) {
          if (!existing.samePayload) {
            throw new RequestIntakeError("idempotency_conflict");
          }
          return {
            requestId: existing.requestId,
            requestNo: existing.requestNo,
            redirectTo: `/solicitudes/${existing.requestId}`,
            warnings: existing.warnings,
          };
        }
        const target =
          input.requestFor === "self"
            ? await resolveSelf(transaction, authorization)
            : await resolveOnBehalf(
                transaction,
                authorization,
                input,
                occurredAt,
              );
        assertCapability(authorization, "request:create", target.companyId);
        if (target.status !== "active") {
          throw new RequestIntakeError("person_inactive");
        }
        const catalog = await validateCatalog(
          transaction,
          target.companyId,
          input.vendorAccountId,
          input.licenseTypeId,
        );
        await rejectDuplicateAssignment(
          transaction,
          target.id,
          target.companyId,
          input.vendorAccountId,
          input.licenseTypeId,
        );
        const warnings = await requestWarnings(
          transaction,
          target.id,
          target.email,
          target.companyId,
          input.vendorAccountId,
          input.licenseTypeId,
          catalog,
          occurredAt,
        );
        const requestNo = await allocateRequestNo(transaction);
        const inserted = await transaction.execute<{ readonly id: string }>(
          sql`INSERT INTO license_request
                (request_no, client_request_id, person_id, company_id, vendor_account_id,
                 license_type_id, state, justification, needed_by,
                 requested_by, created_at, created_by, updated_at)
              VALUES
                (${requestNo}, ${input.clientRequestId}::uuid,
                 ${target.id}::uuid, ${target.companyId}::uuid,
                 ${input.vendorAccountId}::uuid, ${input.licenseTypeId}::uuid,
                 'submitted', ${input.justification},
                 ${input.neededBy ?? null}::date,
                 ${authorization.userAccountId}::uuid, ${occurredAt},
                 ${authorization.userAccountId}::uuid, ${occurredAt})
              RETURNING id::text AS id`,
        );
        const requestId = inserted.rows[0]!.id;
        await transaction.execute(
          sql`INSERT INTO request_transition
                (request_id, from_state, to_state, actor_user_id, note, occurred_at)
              VALUES
                (${requestId}::uuid, NULL, 'submitted',
                 ${authorization.userAccountId}::uuid, NULL, ${occurredAt})`,
        );
        await transaction.execute(
          sql`INSERT INTO audit_log
                (actor_user_id, action, entity_type, entity_id, company_id,
                 before, after, occurred_at)
              VALUES
                (${authorization.userAccountId}::uuid, 'request.submitted',
                 'LicenseRequest', ${requestId}::uuid, ${target.companyId}::uuid,
                 NULL, ${JSON.stringify({
                   state: "submitted",
                   clientPayload,
                   warnings,
                 })}::jsonb,
                 ${occurredAt})`,
        );
        assertLegalTransition("submitted", "pending_approval");
        await transaction.execute(
          sql`UPDATE license_request
              SET state = 'pending_approval', updated_at = ${occurredAt}
              WHERE id = ${requestId}::uuid
                AND company_id = ${target.companyId}::uuid
                AND state = 'submitted'`,
        );
        await transaction.execute(
          sql`INSERT INTO request_transition
                (request_id, from_state, to_state, actor_user_id, note, occurred_at)
              VALUES
                (${requestId}::uuid, 'submitted', 'pending_approval',
                 ${authorization.userAccountId}::uuid, NULL, ${occurredAt})`,
        );
        await transaction.execute(
          sql`INSERT INTO audit_log
                (actor_user_id, action, entity_type, entity_id, company_id,
                 before, after, occurred_at)
              VALUES
                (${authorization.userAccountId}::uuid, 'request.pending_approval',
                 'LicenseRequest', ${requestId}::uuid, ${target.companyId}::uuid,
                 ${JSON.stringify({ state: "submitted" })}::jsonb,
                 ${JSON.stringify({ state: "pending_approval" })}::jsonb,
                 ${occurredAt})`,
        );
        await enqueueLifecyclePendingApproval(
          transaction,
          requestId,
          occurredAt,
        );
        return {
          requestId,
          requestNo,
          redirectTo: `/solicitudes/${requestId}`,
          warnings,
        };
      });
      await lifecycleDispatcher
        ?.dispatchRequest(result.requestId)
        .catch(() => undefined);
      return result;
    },
  };
}

export type RequestRepository = ReturnType<typeof createRequestRepository>;

const productionDatabase = db as unknown as Database;
export const requestRepository = createRequestRepository(productionDatabase, {
  lifecycleDispatcher: createLifecycleNotificationDispatcher(
    productionDatabase,
    { workerId: "web-request-intake" },
  ),
});

export const requestReadRepository = createRequestReadRepository(
  db as unknown as Database,
  () => new Date(),
);
