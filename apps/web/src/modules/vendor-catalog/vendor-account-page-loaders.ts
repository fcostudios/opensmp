import type { LedgerAuthorization } from "../identity-access/authorization";
import { parseVendorAccountId } from "./pool-repository";
import type { PoolRepository, VendorPoolSnapshot } from "./pool-repository";
import type { VendorAccountDetail, VendorAccountListItem, VendorAccountRepository } from "./vendor-account-repository";

export interface VendorAccountsRegistryPageData {
  readonly accounts: readonly VendorAccountListItem[];
  readonly vendors: readonly { readonly id: string; readonly name: string }[];
}

export interface VendorAccountDetailPageData {
  readonly at: Date;
  readonly detail: VendorAccountDetail;
  readonly snapshots: readonly VendorPoolSnapshot[];
}

export async function loadVendorAccountsRegistryPage(input: {
  readonly at: Date;
  readonly authorization: LedgerAuthorization;
  readonly repository: VendorAccountRepository;
}): Promise<VendorAccountsRegistryPageData> {
  const [accounts, vendors] = await Promise.all([
    input.repository.list(input.authorization, input.at),
    input.repository.activeAnthropicOptions(input.authorization),
  ]);
  return { accounts, vendors };
}

export async function loadVendorAccountDetailPage(input: {
  readonly at: Date;
  readonly authorization: LedgerAuthorization;
  readonly poolRepository: PoolRepository;
  readonly rawVendorAccountId: string;
  readonly vendorAccountRepository: VendorAccountRepository;
}): Promise<VendorAccountDetailPageData | null> {
  const vendorAccountId = parseVendorAccountId(input.rawVendorAccountId);
  if (!vendorAccountId) return null;
  const [detail, snapshots] = await Promise.all([
    input.vendorAccountRepository.detail(input.authorization, vendorAccountId, input.at),
    input.poolRepository.listSnapshots(input.authorization, input.at, vendorAccountId),
  ]);
  return detail ? { at: input.at, detail, snapshots } : null;
}
