import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  createVendorAccountSchema,
  updateVendorAccountSchema,
  type VendorAccountStatus,
} from "@smp/contracts";
// eslint-disable-next-line no-restricted-imports -- This service owns the audited vendor-account transaction.
import { vendorAccount } from "@smp/db/schema";
// eslint-disable-next-line no-restricted-imports -- Required for the typed Drizzle transaction boundary.
import * as schema from "@smp/db/schema";

import { withAudit } from "../audit/with-audit";
import type { LedgerAuthorization } from "../identity-access/authorization";

type Database = NodePgDatabase<typeof schema>;
type VendorAccountErrorCode =
  | "VENDOR_ACCOUNT_ACCESS_FORBIDDEN"
  | "VENDOR_ACCOUNT_INPUT_INVALID"
  | "VENDOR_ACCOUNT_NAME_CONFLICT"
  | "VENDOR_ACCOUNT_NO_CHANGES"
  | "VENDOR_ACCOUNT_NOT_FOUND"
  | "VENDOR_ACCOUNT_ORG_REF_CONFLICT"
  | "VENDOR_ACCOUNT_VENDOR_UNAVAILABLE";

interface AccountSnapshot extends Record<string, unknown> {
  readonly contractRenewalOn: string | null;
  readonly lowPoolFloor: number;
  readonly mode: "automated" | "orchestration";
  readonly name: string;
  readonly status: VendorAccountStatus;
  readonly vendorOrgRef: string | null;
}

interface PgFailure {
  readonly code?: string;
  readonly constraint?: string;
  readonly cause?: PgFailure;
}

export class VendorAccountError extends Error {
  constructor(readonly code: VendorAccountErrorCode) {
    super(code);
    this.name = "VendorAccountError";
  }
}

function reject(code: VendorAccountErrorCode): never {
  throw new VendorAccountError(code);
}

function assertAccess(authorization: LedgerAuthorization): void {
  if (authorization.globalRole !== "group_admin") {
    reject("VENDOR_ACCOUNT_ACCESS_FORBIDDEN");
  }
}

function pgFailure(error: unknown): PgFailure {
  return error !== null && typeof error === "object" ? error as PgFailure : {};
}

function mapPersistenceFailure(error: unknown): never {
  const failure = pgFailure(error);
  const code = failure.code ?? failure.cause?.code;
  const constraint = failure.constraint ?? failure.cause?.constraint;
  if (code === "23505" && constraint === "uq_vendor_account_vendor_id_name") {
    reject("VENDOR_ACCOUNT_NAME_CONFLICT");
  }
  if (code === "23505" && constraint === "uq_vendor_account_vendor_id_vendor_org_ref") {
    reject("VENDOR_ACCOUNT_ORG_REF_CONFLICT");
  }
  if (code === "23514") reject("VENDOR_ACCOUNT_INPUT_INVALID");
  throw error;
}

function sameSnapshot(left: AccountSnapshot, right: AccountSnapshot): boolean {
  return left.contractRenewalOn === right.contractRenewalOn &&
    left.lowPoolFloor === right.lowPoolFloor &&
    left.mode === right.mode &&
    left.name === right.name &&
    left.status === right.status &&
    left.vendorOrgRef === right.vendorOrgRef;
}

export function createVendorAccountService(
  database: Database,
  options: { readonly now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date());

  return {
    async createVendorAccount(
      authorization: LedgerAuthorization,
      input: unknown,
    ): Promise<{ readonly id: string }> {
      const occurredAt = now();
      try {
        return await withAudit(database, async (transaction) => {
          assertAccess(authorization);
          const parsed = createVendorAccountSchema.safeParse(input);
          if (!parsed.success) reject("VENDOR_ACCOUNT_INPUT_INVALID");
          const command = parsed.data;
          const selectedVendor = await transaction.execute<{ readonly id: string }>(
            sql`SELECT id::text AS id
                FROM vendor
                WHERE id = ${command.vendorId}::uuid
                  AND status = 'active'
                  AND lower(name) = 'anthropic'
                FOR UPDATE`,
          );
          if (!selectedVendor.rows[0]) {
            reject("VENDOR_ACCOUNT_VENDOR_UNAVAILABLE");
          }
          const inserted = await transaction.insert(vendorAccount).values({
            vendorId: command.vendorId,
            name: command.name,
            mode: command.mode,
            vendorOrgRef: command.vendorOrgRef,
            contractRenewalOn: command.contractRenewalOn,
            lowPoolFloor: command.lowPoolFloor,
            status: "active",
            createdAt: occurredAt,
            createdBy: authorization.userAccountId,
          }).returning({ id: vendorAccount.id });
          const id = inserted[0]!.id;
          return {
            value: { id },
            audit: {
              actorUserId: authorization.userAccountId,
              action: "vendor_account.created",
              entityType: "VendorAccount",
              entityId: id,
              companyId: null,
              note: null,
              before: null,
              after: {
                vendorId: command.vendorId,
                name: command.name,
                mode: command.mode,
                vendorOrgRef: command.vendorOrgRef,
                contractRenewalOn: command.contractRenewalOn,
                lowPoolFloor: command.lowPoolFloor,
                status: "active",
              },
            },
          };
        }, { occurredAt });
      } catch (error) {
        mapPersistenceFailure(error);
      }
    },

    async updateVendorAccount(
      authorization: LedgerAuthorization,
      input: unknown,
    ): Promise<{ readonly id: string; readonly status: VendorAccountStatus }> {
      const occurredAt = now();
      try {
        return await withAudit(database, async (transaction) => {
          assertAccess(authorization);
          const parsed = updateVendorAccountSchema.safeParse(input);
          if (!parsed.success) reject("VENDOR_ACCOUNT_INPUT_INVALID");
          const command = parsed.data;
          const selected = await transaction.execute<AccountSnapshot>(
            sql`SELECT name, mode, vendor_org_ref AS "vendorOrgRef",
                       contract_renewal_on::text AS "contractRenewalOn",
                       low_pool_floor::int AS "lowPoolFloor", status
                FROM vendor_account
                WHERE id = ${command.id}::uuid
                FOR UPDATE`,
          );
          const before = selected.rows[0];
          if (!before) reject("VENDOR_ACCOUNT_NOT_FOUND");
          const after: AccountSnapshot = {
            name: command.name,
            mode: command.mode,
            vendorOrgRef: command.vendorOrgRef,
            contractRenewalOn: command.contractRenewalOn,
            lowPoolFloor: command.lowPoolFloor,
            status: command.status,
          };
          if (sameSnapshot(before, after)) reject("VENDOR_ACCOUNT_NO_CHANGES");

          await transaction.update(vendorAccount).set({
            name: after.name,
            mode: after.mode,
            vendorOrgRef: after.vendorOrgRef,
            contractRenewalOn: after.contractRenewalOn,
            lowPoolFloor: after.lowPoolFloor,
            status: after.status,
            updatedAt: occurredAt,
            updatedBy: authorization.userAccountId,
          }).where(eq(vendorAccount.id, command.id));
          const action = before.status === after.status
            ? "vendor_account.updated"
            : after.status === "inactive"
              ? "vendor_account.retired"
              : "vendor_account.reactivated";
          return {
            value: { id: command.id, status: after.status },
            audit: {
              actorUserId: authorization.userAccountId,
              action,
              entityType: "VendorAccount",
              entityId: command.id,
              companyId: null,
              note: null,
              before,
              after,
            },
          };
        }, { occurredAt });
      } catch (error) {
        mapPersistenceFailure(error);
      }
    },
  };
}

export type VendorAccountService = ReturnType<typeof createVendorAccountService>;
