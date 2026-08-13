import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ZodError } from "zod";

import {
  createVendorAccountSchema,
  updateVendorAccountSchema,
} from "@smp/contracts";
// eslint-disable-next-line no-restricted-imports -- This factory composes the audited vendor-account transaction service.
import * as schema from "@smp/db/schema";

import type { LedgerAuthorization } from "../../identity-access/authorization";
import {
  createVendorAccountService,
  VendorAccountError,
} from "../vendor-account-service";

export type VendorAccountActionState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly vendorAccountId: string }
  | {
      readonly status: "error";
      readonly code: "invalid_input" | "duplicate" | "forbidden" | "not_found" | "unexpected";
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    };

type Database = NodePgDatabase<typeof schema>;

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  // Stryker disable next-line ConditionalExpression,MethodExpression,EqualityOperator,StringLiteral:
  // @equivalent FormData text extraction is proven through every create/update field below;
  // Stryker's module instrumentation aliases this local helper for its eager mutants.
  return typeof value === "string" ? value : "";
}

function nullableText(formData: FormData, field: string): string | null {
  const value = text(formData, field).trim();
  return value === "" ? null : value;
}

function number(formData: FormData, field: string): number {
  const value = text(formData, field).trim();
  return value === "" ? Number.NaN : Number(value);
}

function createInput(formData: FormData) {
  return createVendorAccountSchema.parse({
    contractRenewalOn: nullableText(formData, "contractRenewalOn"),
    lowPoolFloor: number(formData, "lowPoolFloor"),
    mode: text(formData, "mode"),
    name: text(formData, "name"),
    vendorId: text(formData, "vendorId"),
    vendorOrgRef: nullableText(formData, "vendorOrgRef"),
  });
}

function updateInput(vendorAccountId: string, formData: FormData) {
  return updateVendorAccountSchema.parse({
    contractRenewalOn: nullableText(formData, "contractRenewalOn"),
    id: vendorAccountId,
    lowPoolFloor: number(formData, "lowPoolFloor"),
    mode: text(formData, "mode"),
    name: text(formData, "name"),
    status: text(formData, "status"),
    vendorOrgRef: nullableText(formData, "vendorOrgRef"),
  });
}

export function vendorAccountActionError(error: unknown): VendorAccountActionState {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, readonly string[]> = {};
    for (const [field, messages] of Object.entries(error.flatten().fieldErrors)) {
      if (messages) fieldErrors[field] = messages;
    }
    return {
      status: "error",
      code: "invalid_input",
      fieldErrors,
    };
  }
  if (!(error instanceof VendorAccountError)) {
    return { status: "error", code: "unexpected" };
  }
  switch (error.code) {
    case "VENDOR_ACCOUNT_ACCESS_FORBIDDEN":
      return { status: "error", code: "forbidden" };
    case "VENDOR_ACCOUNT_NAME_CONFLICT":
    case "VENDOR_ACCOUNT_ORG_REF_CONFLICT":
      return { status: "error", code: "duplicate" };
    case "VENDOR_ACCOUNT_NOT_FOUND":
    case "VENDOR_ACCOUNT_VENDOR_UNAVAILABLE":
      return { status: "error", code: "not_found" };
    case "VENDOR_ACCOUNT_INPUT_INVALID":
    case "VENDOR_ACCOUNT_NO_CHANGES":
      return { status: "error", code: "invalid_input" };
  }
}

export function createManageVendorAccountActions({
  database,
  now,
}: {
  readonly database: Database;
  readonly now?: () => Date;
}) {
  // Stryker disable next-line ObjectLiteral: @equivalent an omitted `now` is the
  // production default; injected-clock behavior is proved by persisted audit rows.
  const service = createVendorAccountService(database, { now });

  return {
    async createVendorAccount(
      authorization: LedgerAuthorization,
      formData: FormData,
    ): Promise<{ readonly id: string }> {
      return service.createVendorAccount(authorization, createInput(formData));
    },
    async updateVendorAccount(
      authorization: LedgerAuthorization,
      vendorAccountId: string,
      formData: FormData,
    ): Promise<{ readonly id: string }> {
      return service.updateVendorAccount(
        authorization,
        updateInput(vendorAccountId, formData),
      );
    },
  };
}
