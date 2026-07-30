import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type {
  PersonInput,
  StartOffboardingInput,
} from "@smp/contracts";
import {
  createConnectorDispatcher,
  planProvisioningAction,
} from "@smp/connectors";
import {
  permittedCompanyIds,
} from "@smp/domain/identity-access";
import { assertLegalTransition } from "@smp/domain/request-workflow";
import {
  activityRecord,
  auditLog,
  company,
  licenseAssignment,
  licenseRequest,
  licenseType,
  person,
  provisioningAction,
  requestTransition,
  vendorAccount,
  vendor,
} from "@smp/db/schema";
import { db } from "@smp/db";
import * as schema from "@smp/db/schema";

import { withAudit } from "../audit/with-audit";
import type { LedgerAuthorization } from "../identity-access/authorization";

type Database = NodePgDatabase<typeof schema>;
type PersonRow = typeof person.$inferSelect;
type LicenseAssignmentRow = typeof licenseAssignment.$inferSelect;

export type PeopleRepositoryErrorCode =
  | "company_move_confirmation_required"
  | "person_email_conflict"
  | "person_forbidden"
  | "person_not_found"
  | "person_offboarding_unavailable"
  | "person_request_number_conflict";

export class PeopleRepositoryError extends Error {
  readonly status: number;

  constructor(readonly code: PeopleRepositoryErrorCode) {
    super(code);
    this.name = "PeopleRepositoryError";
    this.status =
      code === "person_forbidden"
        ? 403
        : code === "person_email_conflict"
          ? 409
          : code === "company_move_confirmation_required" ||
              code === "person_offboarding_unavailable" ||
              code === "person_request_number_conflict"
            ? 422
            : 404;
  }
}

export interface PersonListItem {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly status: PersonRow["status"];
  readonly currentLicense: string | null;
  readonly currentLicenseState: "active" | "none";
  readonly lastActiveOn: string | null;
  readonly freshnessAt: Date | null;
}

export interface PersonDetail extends PersonListItem {
  readonly assignmentHistory: readonly {
    readonly id: string;
    readonly companyId: string;
    readonly companyName: string;
    readonly vendorAccountName: string;
    readonly licenseTypeName: string;
    readonly startedOn: string;
    readonly endedOn: string | null;
    readonly endReason: (typeof licenseAssignment.$inferSelect)["endReason"];
    readonly sourceKind: (typeof licenseAssignment.$inferSelect)["sourceKind"];
    readonly sourceRequestId: string | null;
  }[];
  readonly activityHistory: readonly {
    readonly id: string;
    readonly activityDate: string;
    readonly counters: unknown;
    readonly syncedAt: Date;
  }[];
}

export interface PersonMutationResult {
  readonly person: PersonRow;
  readonly closedAssignments: number;
  readonly createdSuccessors: number;
  readonly fastTrackRequestId: string | null;
  readonly fastTrackRequestIds: readonly string[];
  readonly reRequestHref: string | null;
  readonly reRequestHrefs: readonly string[];
}

export interface StartOffboardingResult {
  readonly person: PersonRow;
  readonly status: "offboarding";
  readonly affectedRequestIds: readonly string[];
  readonly provisioningActionIds: readonly string[];
}

function readScope(
  authorization: LedgerAuthorization,
  column: AnyPgColumn,
): SQL {
  const permitted = permittedCompanyIds(authorization, "company:read");
  if (permitted === "all") return sql`TRUE`;
  const ids = [...permitted];
  // @equivalent: Drizzle compiles inArray(column, []) to SQL false, exactly
  // matching the explicit sql`FALSE` guard used for readability.
  return ids.length === 0 ? sql`FALSE` : inArray(column, ids);
}

function requireAdmin(
  authorization: LedgerAuthorization,
  ..._companyIds: readonly string[]
): void {
  if (authorization.globalRole !== "group_admin") {
    throw new PeopleRepositoryError("person_forbidden");
  }
}

function normalize<T extends PersonInput>(input: T): T {
  return {
    ...input,
    fullName: input.fullName.trim(),
    email: input.email.trim().toLowerCase(),
  } as T;
}

function isUniqueEmailError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    readonly constraint?: string;
    readonly cause?: {
      readonly constraint?: string;
      readonly message?: string;
    };
    readonly message?: string;
  };
  return (
    candidate.constraint === "uq_person_lower_email" ||
    candidate.cause?.constraint === "uq_person_lower_email" ||
    candidate.message?.includes("uq_person_lower_email") === true ||
    candidate.cause?.message?.includes("uq_person_lower_email") === true
  );
}

function isUniqueRequestNumberError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    readonly constraint?: string;
    readonly cause?: { readonly constraint?: string };
  };
  return (
    candidate.constraint === "uq_license_request_request_no" ||
    candidate.cause?.constraint === "uq_license_request_request_no"
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    readonly code?: string;
    readonly cause?: { readonly code?: string };
  };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function previousCalendarDate(date: Date): string {
  const previous = new Date(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return calendarDate(previous);
}

function productionRequestNumber(occurredAt: Date): string {
  return `MOVE-${calendarDate(occurredAt).replaceAll("-", "")}-${randomUUID()}`;
}

export function createPeopleRepository(
  database: Database,
  {
    requestNumber = productionRequestNumber,
  }: {
    readonly requestNumber?: (occurredAt: Date, index: number) => string;
  } = {},
) {
  async function list(
    authorization: LedgerAuthorization,
  ): Promise<readonly PersonListItem[]> {
    const people = await database
      .select({
        id: person.id,
        fullName: person.fullName,
        email: person.email,
        companyId: person.companyId,
        companyName: company.name,
        status: person.status,
      })
      .from(person)
      .innerJoin(company, eq(company.id, person.companyId))
      .where(readScope(authorization, person.companyId))
      .orderBy(asc(person.fullName), asc(person.id));
    if (people.length === 0) return [];

    const personIds = people.map(({ id }) => id);
    const [assignments, activity] = await Promise.all([
      database
        .select({
          personId: licenseAssignment.personId,
          licenseTypeName: licenseType.name,
        })
        .from(licenseAssignment)
        .innerJoin(
          licenseType,
          eq(licenseType.id, licenseAssignment.licenseTypeId),
        )
        .where(
          and(
            inArray(licenseAssignment.personId, personIds),
            isNull(licenseAssignment.endedOn),
            readScope(authorization, licenseAssignment.companyId),
          ),
        )
        .orderBy(
          asc(licenseAssignment.personId),
          asc(licenseAssignment.startedOn),
        ),
      database
        .select({
          personId: activityRecord.personId,
          activityDate: activityRecord.activityDate,
          syncedAt: activityRecord.syncedAt,
        })
        .from(activityRecord)
        .where(inArray(activityRecord.personId, personIds))
        .orderBy(
          asc(activityRecord.personId),
          desc(activityRecord.activityDate),
          desc(activityRecord.syncedAt),
        ),
    ]);
    const currentByPerson = new Map<string, string>();
    for (const assignment of assignments) {
      const prior = currentByPerson.get(assignment.personId);
      currentByPerson.set(
        assignment.personId,
        prior
          ? `${prior} · ${assignment.licenseTypeName}`
          : assignment.licenseTypeName,
      );
    }
    const latestActivity = new Map<
      string,
      { readonly activityDate: string; readonly syncedAt: Date }
    >();
    for (const row of activity) {
      if (!latestActivity.has(row.personId)) {
        latestActivity.set(row.personId, row);
      }
    }

    return people.map((row) => {
      const currentLicense = currentByPerson.get(row.id) ?? null;
      const latest = latestActivity.get(row.id);
      return {
        ...row,
        currentLicense,
        currentLicenseState: currentLicense ? "active" : "none",
        lastActiveOn: latest?.activityDate ?? null,
        freshnessAt: latest?.syncedAt ?? null,
      };
    });
  }

  async function detail(
    authorization: LedgerAuthorization,
    personId: string,
  ): Promise<PersonDetail> {
    const [summary] = (await list(authorization)).filter(
      (candidate) => candidate.id === personId,
    );
    if (!summary) {
      throw new PeopleRepositoryError("person_not_found");
    }
    const [assignmentHistory, activityHistory] = await Promise.all([
      database
        .select({
          id: licenseAssignment.id,
          companyId: licenseAssignment.companyId,
          companyName: company.name,
          vendorAccountName: vendorAccount.name,
          licenseTypeName: licenseType.name,
          startedOn: licenseAssignment.startedOn,
          endedOn: licenseAssignment.endedOn,
          endReason: licenseAssignment.endReason,
          sourceKind: licenseAssignment.sourceKind,
          sourceRequestId: licenseAssignment.sourceRequestId,
        })
        .from(licenseAssignment)
        .innerJoin(company, eq(company.id, licenseAssignment.companyId))
        .innerJoin(
          vendorAccount,
          eq(vendorAccount.id, licenseAssignment.vendorAccountId),
        )
        .innerJoin(
          licenseType,
          eq(licenseType.id, licenseAssignment.licenseTypeId),
        )
        .where(
          and(
            eq(licenseAssignment.personId, personId),
            readScope(authorization, licenseAssignment.companyId),
          ),
        )
        .orderBy(desc(licenseAssignment.startedOn), desc(licenseAssignment.id)),
      database
        .select({
          id: activityRecord.id,
          activityDate: activityRecord.activityDate,
          counters: activityRecord.counters,
          syncedAt: activityRecord.syncedAt,
        })
        .from(activityRecord)
        .where(eq(activityRecord.personId, personId))
        .orderBy(
          desc(activityRecord.activityDate),
          desc(activityRecord.syncedAt),
        )
        .limit(30),
    ]);
    return { ...summary, assignmentHistory, activityHistory };
  }

  async function create(
    authorization: LedgerAuthorization,
    rawInput: PersonInput,
    occurredAt = new Date(),
  ): Promise<PersonRow> {
    const input = normalize(rawInput);
    requireAdmin(authorization, input.companyId);
    try {
      return await withAudit(
        database,
        async (transaction) => {
          const [saved] = await transaction
            .insert(person)
            .values({
              fullName: input.fullName,
              email: input.email,
              companyId: input.companyId,
              status: input.status,
              createdAt: occurredAt,
              createdBy: authorization.userAccountId,
            })
            .returning();
          return {
            value: saved,
            audit: {
              actorUserId: authorization.userAccountId,
              action: "person.created",
              entityType: "Person",
              entityId: saved.id,
              companyId: saved.companyId,
              note: null,
              before: null,
              after: {
                fullName: saved.fullName,
                email: saved.email,
                companyId: saved.companyId,
                status: saved.status,
              },
            },
          };
        },
        { occurredAt },
      );
    } catch (error) {
      if (isUniqueEmailError(error) || isUniqueViolation(error)) {
        throw new PeopleRepositoryError("person_email_conflict");
      }
      throw error;
    }
  }

  async function update(
    authorization: LedgerAuthorization,
    rawInput: PersonInput & { readonly id: string },
    occurredAt = new Date(),
  ): Promise<PersonMutationResult> {
    const input = normalize(rawInput);
    requireAdmin(authorization);
    try {
      return await withAudit(
        database,
        async (transaction) => {
          const [existing] = await transaction
            .select()
            .from(person)
            .where(eq(person.id, input.id))
            .for("update")
            .limit(1);
          if (!existing) {
            throw new PeopleRepositoryError("person_not_found");
          }
          const moving = existing.companyId !== input.companyId;
          const openAssignments = moving
            ? await transaction
                .select()
                .from(licenseAssignment)
                .where(
                  and(
                    eq(licenseAssignment.personId, existing.id),
                    eq(licenseAssignment.companyId, existing.companyId),
                    isNull(licenseAssignment.endedOn),
                  ),
                )
                .orderBy(asc(licenseAssignment.id))
                .for("update")
            : [];
          if (
            openAssignments.length > 0 &&
            !input.confirmCompanyMove
          ) {
            throw new PeopleRepositoryError(
              "company_move_confirmation_required",
            );
          }

          const fastTrackRequestIds: string[] = [];
          let createdSuccessors = 0;
          const endedOn = previousCalendarDate(occurredAt);
          const startedOn = calendarDate(occurredAt);
          if (openAssignments.length > 0) {
            for (const assignment of openAssignments) {
              await transaction
                .update(licenseAssignment)
                .set({ endedOn, endReason: "reallocated" })
                .where(
                  and(
                    eq(licenseAssignment.id, assignment.id),
                    eq(
                      licenseAssignment.companyId,
                      existing.companyId,
                    ),
                    isNull(licenseAssignment.endedOn),
                  ),
                );
            }
            const successors: LicenseAssignmentRow[] = [];
            for (const [index, assignment] of openAssignments.entries()) {
              const [request] = await transaction
                .insert(licenseRequest)
                .values({
                  requestNo: requestNumber(occurredAt, index),
                  personId: existing.id,
                  companyId: input.companyId,
                  vendorAccountId: assignment.vendorAccountId,
                  licenseTypeId: assignment.licenseTypeId,
                  state: "active",
                  justification: "cambio de compañía",
                  requestedBy: authorization.userAccountId,
                  createdAt: occurredAt,
                  createdBy: authorization.userAccountId,
                })
                .returning();
              const [successor] = await transaction
                .insert(licenseAssignment)
                .values({
                  personId: assignment.personId,
                  companyId: input.companyId,
                  vendorAccountId: assignment.vendorAccountId,
                  licenseTypeId: assignment.licenseTypeId,
                  startedOn,
                  endedOn: null,
                  endReason: null,
                  sourceRequestId: request.id,
                  sourceKind: "request" as const,
                  note: "cambio de compañía",
                  createdAt: occurredAt,
                  createdBy: authorization.userAccountId,
                })
                .returning();
              await transaction
                .update(licenseRequest)
                .set({ licenseAssignmentId: successor.id })
                .where(eq(licenseRequest.id, request.id));
              await transaction.insert(requestTransition).values({
                requestId: request.id,
                fromState: null,
                toState: "active",
                actorUserId: authorization.userAccountId,
                note: "cambio de compañía",
                occurredAt,
              });
              fastTrackRequestIds.push(request.id);
              successors.push(successor);
            }
            createdSuccessors = successors.length;

            await transaction.insert(auditLog).values([
              ...fastTrackRequestIds.map((requestId) => ({
                actorUserId: authorization.userAccountId,
                action: "license_request.fast_track_materialized",
                entityType: "LicenseRequest",
                entityId: requestId,
                companyId: input.companyId,
                note: "cambio de compañía",
                before: { state: null },
                after: { state: "active" },
                occurredAt,
              })),
              ...openAssignments.map((assignment) => ({
                actorUserId: authorization.userAccountId,
                action: "license_assignment.reallocated",
                entityType: "LicenseAssignment",
                entityId: assignment.id,
                companyId: existing.companyId,
                note: "cambio de compañía",
                before: { endedOn: null, endReason: null },
                after: { endedOn, endReason: "reallocated" },
                occurredAt,
              })),
              ...successors.map((successor) => ({
                actorUserId: authorization.userAccountId,
                action: "license_assignment.successor_created",
                entityType: "LicenseAssignment",
                entityId: successor.id,
                companyId: input.companyId,
                note: "cambio de compañía",
                before: null,
                after: {
                  startedOn,
                  sourceKind: "request",
                  sourceRequestId: successor.sourceRequestId,
                },
                occurredAt,
              })),
            ]);
          }

          const [saved] = await transaction
            .update(person)
            .set({
              fullName: input.fullName,
              email: input.email,
              companyId: input.companyId,
              status: input.status,
              updatedAt: occurredAt,
              updatedBy: authorization.userAccountId,
            })
            .where(
              and(
                eq(person.id, existing.id),
                eq(person.companyId, existing.companyId),
              ),
            )
            .returning();
          // Stryker disable all: @equivalent: the locked Person row cannot
          // disappear and both predicates are immutable values from that row.
          if (!saved) throw new PeopleRepositoryError("person_not_found");
          // Stryker restore all

          fastTrackRequestIds.sort();
          const reRequestHrefs = fastTrackRequestIds.map(
            (requestId) => `/solicitudes/${requestId}`,
          );
          return {
            value: {
              person: saved,
              closedAssignments: openAssignments.length,
              createdSuccessors,
              fastTrackRequestId: fastTrackRequestIds[0] ?? null,
              fastTrackRequestIds,
              reRequestHref: reRequestHrefs[0] ?? null,
              reRequestHrefs,
            },
            audit: {
              actorUserId: authorization.userAccountId,
              action: moving ? "person.company_moved" : "person.updated",
              entityType: "Person",
              entityId: existing.id,
              companyId: input.companyId,
              note: moving ? "cambio de compañía" : null,
              before: {
                fullName: existing.fullName,
                email: existing.email,
                companyId: existing.companyId,
                status: existing.status,
              },
              after: {
                fullName: saved.fullName,
                email: saved.email,
                companyId: saved.companyId,
                status: saved.status,
              },
            },
          };
        },
        { occurredAt },
      );
    } catch (error) {
      if (isUniqueRequestNumberError(error)) {
        throw new PeopleRepositoryError("person_request_number_conflict");
      }
      if (isUniqueEmailError(error)) {
        throw new PeopleRepositoryError("person_email_conflict");
      }
      throw error;
    }
  }

  async function startOffboarding(
    authorization: LedgerAuthorization,
    input: StartOffboardingInput,
    occurredAt = new Date(),
  ): Promise<StartOffboardingResult> {
    requireAdmin(authorization);
    assertLegalTransition("active", "offboarding");
    return withAudit(
      database,
      async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(person)
          .where(
            and(
              eq(person.id, input.personId),
              readScope(authorization, person.companyId),
            ),
          )
          .for("update")
          .limit(1);
        if (!existing) {
          throw new PeopleRepositoryError(
            "person_offboarding_unavailable",
          );
        }
        const openAssignments = await transaction
          .select()
          .from(licenseAssignment)
          .where(
            and(
              eq(licenseAssignment.personId, existing.id),
              eq(licenseAssignment.companyId, existing.companyId),
              isNull(licenseAssignment.endedOn),
            ),
          )
          .orderBy(asc(licenseAssignment.id))
          .for("update");
        if (
          openAssignments.length === 0 ||
          openAssignments.some(
            (assignment) => assignment.sourceRequestId === null,
          )
        ) {
          throw new PeopleRepositoryError(
            "person_offboarding_unavailable",
          );
        }
        const requestIds = [
          ...new Set(
            openAssignments.map(
              (assignment) => assignment.sourceRequestId!,
            ),
          ),
        ].sort();
        const activeRequests = await transaction
          .select()
          .from(licenseRequest)
          .where(
            and(
              inArray(licenseRequest.id, requestIds),
              eq(licenseRequest.personId, existing.id),
              eq(licenseRequest.companyId, existing.companyId),
              inArray(licenseRequest.state, ["active", "offboarding"]),
            ),
          )
          .orderBy(asc(licenseRequest.id))
          .for("update");
        const requestById = new Map(
          activeRequests.map((request) => [request.id, request]),
        );
        const usable =
          activeRequests.length === requestIds.length &&
          openAssignments.every((assignment) => {
            const request = requestById.get(
              assignment.sourceRequestId!,
            );
            return (
              request !== undefined &&
              request.vendorAccountId === assignment.vendorAccountId
            );
          }) &&
          (activeRequests.every((request) => request.state === "active") ||
            activeRequests.every(
              (request) => request.state === "offboarding",
            ));
        if (!usable) {
          // TODO(US-024): materialize an active source request for legacy
          // imported assignments before enabling their offboarding.
          throw new PeopleRepositoryError(
            "person_offboarding_unavailable",
          );
        }

        if (
          activeRequests.every(
            (request) => request.state === "offboarding",
          )
        ) {
          const existingActions = await transaction
            .select({
              id: provisioningAction.id,
              kind: provisioningAction.kind,
              mode: provisioningAction.mode,
              rawRequest: provisioningAction.rawRequest,
              requestId: provisioningAction.requestId,
              status: provisioningAction.status,
              vendorAccountId: provisioningAction.vendorAccountId,
            })
            .from(provisioningAction)
            .where(
              and(
                inArray(provisioningAction.requestId, requestIds),
                eq(provisioningAction.status, "pending"),
              ),
            )
            .orderBy(asc(provisioningAction.requestId));
          const actionByRequest = new Map(
            existingActions.map((action) => [action.requestId, action]),
          );
          const canonicalActions = activeRequests.every((request) => {
            const action = actionByRequest.get(request.id);
            return (
              action !== undefined &&
              action.kind === "checklist" &&
              action.mode === "orchestration" &&
              // Stryker disable next-line ConditionalExpression: @equivalent
              // The SQL predicate already admits only pending rows.
              action.status === "pending" &&
              // Stryker disable next-line ConditionalExpression: @equivalent
              // Map lookup is keyed by this selected requestId.
              action.requestId === request.id &&
              action.vendorAccountId === request.vendorAccountId &&
              (
                action.rawRequest as
                  | { operation?: unknown }
                  | null
              )?.operation === "deprovision"
            );
          });
          if (!canonicalActions) {
            throw new PeopleRepositoryError(
              "person_offboarding_unavailable",
            );
          }
          const provisioningActionIds = requestIds.map(
            (requestId) => actionByRequest.get(requestId)!.id,
          );
          return {
            value: {
              person: existing,
              status: "offboarding" as const,
              affectedRequestIds: requestIds,
              provisioningActionIds,
            },
            audit: {
              actorUserId: authorization.userAccountId,
              action: "person.offboarding_started",
              entityType: "Person",
              entityId: existing.id,
              companyId: existing.companyId,
              note: input.note,
              before: {
                status: existing.status,
                requestStates: Object.fromEntries(
                  requestIds.map((id) => [id, "offboarding"]),
                ),
              },
              after: {
                status: existing.status,
                requestStates: Object.fromEntries(
                  requestIds.map((id) => [id, "offboarding"]),
                ),
                provisioningActionIds,
              },
            },
          };
        }

        for (const request of activeRequests) {
          const updated = await transaction
            .update(licenseRequest)
            .set({ state: "offboarding", updatedAt: occurredAt })
            .where(
              and(
                eq(licenseRequest.id, request.id),
                eq(licenseRequest.companyId, existing.companyId),
                eq(licenseRequest.state, "active"),
              ),
            )
            .returning({ id: licenseRequest.id });
          // Stryker disable all: @equivalent: each request is locked and was
          // verified active; its id, company, and state cannot change here.
          if (updated.length !== 1) {
            throw new PeopleRepositoryError(
              "person_offboarding_unavailable",
            );
          }
          // Stryker restore all
        }
        await transaction.insert(requestTransition).values(
          activeRequests.map((request) => ({
            requestId: request.id,
            fromState: "active",
            toState: "offboarding",
            actorUserId: authorization.userAccountId,
            note: input.note,
            occurredAt,
          })),
        );
        await transaction.insert(auditLog).values(
          activeRequests.map((request) => ({
            actorUserId: authorization.userAccountId,
            action: "request.offboarding",
            entityType: "LicenseRequest",
            entityId: request.id,
            companyId: existing.companyId,
            note: input.note,
            before: { state: "active" },
            after: { state: "offboarding" },
            occurredAt,
          })),
        );
        const actionPlans = await Promise.all(
          activeRequests.map(async (request) => {
            const [facts] = await transaction
              .select({
                accountMode: vendorAccount.mode,
                canDeprovision: vendor.canDeprovision,
                licenseTypeName: licenseType.name,
                protocol: vendor.provisioningProtocol,
              })
              .from(vendorAccount)
              .innerJoin(vendor, eq(vendor.id, vendorAccount.vendorId))
              .innerJoin(
                licenseType,
                and(
                  eq(licenseType.id, request.licenseTypeId),
                  eq(licenseType.vendorId, vendor.id),
                ),
              )
              .where(eq(vendorAccount.id, request.vendorAccountId))
              .limit(1);
            if (!facts) {
              throw new PeopleRepositoryError(
                "person_offboarding_unavailable",
              );
            }
            const assignmentIds = openAssignments
              .filter(
                (assignment) =>
                  assignment.sourceRequestId === request.id,
              )
              .map((assignment) => assignment.id)
              .sort();
            const plan = await planProvisioningAction(
              createConnectorDispatcher(),
              {
                accountMode: facts.accountMode,
                context: {
                  assignmentIds,
                  endReason: input.endReason,
                  note: input.note,
                  personId: existing.id,
                  requestId: request.id,
                  vendorAccountId: request.vendorAccountId,
                },
                entityIds: {
                  licenseId: request.licenseTypeId,
                  personId: existing.id,
                },
                instruction: {
                  licenseTypeName: facts.licenseTypeName,
                  personEmail: existing.email,
                  requestId: request.id,
                  vendorAccountId: request.vendorAccountId,
                },
                operation: "deprovision",
                protocol: facts.protocol,
                vendorCapability: facts.canDeprovision,
              },
            );
            return { plan, request };
          }),
        );
        const actions = await transaction
          .insert(provisioningAction)
          .values(
            actionPlans.map(({ plan, request }) => {
              return {
                requestId: request.id,
                vendorAccountId: request.vendorAccountId,
                kind: plan.kind,
                mode: plan.mode,
                status: plan.status,
                rawRequest: plan.rawRequest,
                createdAt: occurredAt,
              };
            }),
          )
          .returning({ id: provisioningAction.id });
        // Stryker disable all: @equivalent: INSERT ... RETURNING yields one
        // row for every value in the exact activeRequests mapping.
        if (actions.length !== activeRequests.length) {
          throw new PeopleRepositoryError(
            "person_offboarding_unavailable",
          );
        }
        // Stryker restore all
        const nextStatus =
          input.endReason === "left_company"
            ? "departed"
            : existing.status;
        const [saved] = await transaction
          .update(person)
          .set({
            status: nextStatus,
            updatedAt: occurredAt,
            updatedBy: authorization.userAccountId,
          })
          .where(
            and(
              eq(person.id, existing.id),
              eq(person.companyId, existing.companyId),
            ),
          )
          .returning();
        // Stryker disable all: @equivalent: the locked row cannot disappear,
        // and both predicates are immutable values read from that row.
        if (!saved) {
          throw new PeopleRepositoryError(
            "person_offboarding_unavailable",
          );
        }
        // Stryker restore all
        const provisioningActionIds = actions.map(({ id }) => id);
        const requestStates = Object.fromEntries(
          requestIds.map((id) => [id, "active"]),
        );
        return {
          value: {
            person: saved,
            status: "offboarding" as const,
            affectedRequestIds: requestIds,
            provisioningActionIds,
          },
          audit: {
            actorUserId: authorization.userAccountId,
            action: "person.offboarding_started",
            entityType: "Person",
            entityId: existing.id,
            companyId: existing.companyId,
            note: input.note,
            before: {
              status: existing.status,
              requestStates,
            },
            after: {
              status: saved.status,
              requestStates: Object.fromEntries(
                requestIds.map((id) => [id, "offboarding"]),
              ),
              provisioningActionIds,
            },
          },
        };
      },
      { occurredAt },
    );
  }

  async function companies(
    authorization: LedgerAuthorization,
  ): Promise<readonly { readonly id: string; readonly name: string }[]> {
    return database
      .select({ id: company.id, name: company.name })
      .from(company)
      .where(readScope(authorization, company.id))
      .orderBy(asc(company.name), asc(company.id));
  }

  return {
    companies,
    create,
    detail,
    list,
    startOffboarding,
    update,
  };
}

export type PeopleRepository = ReturnType<typeof createPeopleRepository>;

export const peopleRepository = createPeopleRepository(
  db as unknown as Database,
);
