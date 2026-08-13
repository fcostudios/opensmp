import { ROUTE_SCR_VENDOR_ACCOUNTS } from "@/lib/routes";

import type { LedgerAuthorization } from "../../identity-access/authorization";
import {
  createManageVendorAccountActions,
  type VendorAccountActionState,
  vendorAccountActionError,
} from "./manage-vendor-accounts-operations";

type Database = Parameters<typeof createManageVendorAccountActions>[0]["database"];

export function createVendorAccountServerActions({
  database,
  loadAuthorization,
  now,
  revalidate,
}: {
  readonly database: Database;
  readonly loadAuthorization: () => Promise<LedgerAuthorization | null>;
  readonly now?: () => Date;
  readonly revalidate: (path: string) => void;
}) {
  const actions = createManageVendorAccountActions({ database, now });

  return {
    async createVendorAccount(
      previousState: VendorAccountActionState,
      formData: FormData,
    ): Promise<VendorAccountActionState> {
      void previousState;
      let authorization: LedgerAuthorization | null;
      try {
        authorization = await loadAuthorization();
      } catch {
        return { status: "error", code: "unexpected" };
      }
      if (!authorization) return { status: "error", code: "forbidden" };
      let created: { readonly id: string };
      try {
        created = await actions.createVendorAccount(authorization, formData);
      } catch (error) {
        return vendorAccountActionError(error);
      }
      revalidate(ROUTE_SCR_VENDOR_ACCOUNTS);
      return { status: "success", vendorAccountId: created.id };
    },
    async updateVendorAccount(
      vendorAccountId: string,
      previousState: VendorAccountActionState,
      formData: FormData,
    ): Promise<VendorAccountActionState> {
      void previousState;
      let authorization: LedgerAuthorization | null;
      try {
        authorization = await loadAuthorization();
      } catch {
        return { status: "error", code: "unexpected" };
      }
      if (!authorization) return { status: "error", code: "forbidden" };
      let updated: { readonly id: string };
      try {
        updated = await actions.updateVendorAccount(
          authorization,
          vendorAccountId,
          formData,
        );
      } catch (error) {
        return vendorAccountActionError(error);
      }
      revalidate(ROUTE_SCR_VENDOR_ACCOUNTS);
      revalidate(`${ROUTE_SCR_VENDOR_ACCOUNTS}/${encodeURIComponent(updated.id)}`);
      return { status: "success", vendorAccountId: updated.id };
    },
  };
}
