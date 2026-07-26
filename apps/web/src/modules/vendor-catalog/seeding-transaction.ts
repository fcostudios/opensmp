import { and, eq } from "drizzle-orm";

import {
  integrationCredential,
  licenseType,
  vendor,
  vendorAccount,
  vendorAccountCapacity,
} from "@smp/db/schema";
import type { CapacityImportRow } from "@smp/contracts";
import { serializeCredentialEnvelope } from "@smp/domain";

import type { ImportTransaction } from "@/modules/org-registry/company-import-transaction";
import { encryptCredential } from "./credential-crypto";

export interface CredentialSeed {
  readonly vendorOrgRef: string;
  readonly kind: "admin_scoped" | "analytics";
  readonly plaintext: string;
  readonly scopes?: string;
}

export interface VendorSeedCounts {
  vendorAccounts: number;
  licenseTypes: number;
  capacities: number;
  credentials: number;
}

export async function seedAnthropicCatalog(
  transaction: ImportTransaction,
  capacityRows: readonly CapacityImportRow[],
  actorUserId: string,
  occurredAt: Date,
  credentials: readonly CredentialSeed[] = [],
  kek?: Uint8Array,
  randomBytes?: (length: number) => Uint8Array,
): Promise<VendorSeedCounts> {
  const counts: VendorSeedCounts = {
    vendorAccounts: 0,
    licenseTypes: 0,
    capacities: 0,
    credentials: 0,
  };
  let [anthropic] = await transaction
    .select()
    .from(vendor)
    .where(eq(vendor.name, "Anthropic"))
    .limit(1);
  if (!anthropic) {
    [anthropic] = await transaction.insert(vendor).values({
      name: "Anthropic",
      category: "llm_provider",
      connectorType: "api",
      provisioningProtocol: "rest",
      canProvision: true,
      canDeprovision: true,
      hasUsageData: true,
      hasCostData: true,
      identityMatching: "email",
      status: "active",
      createdAt: occurredAt,
      createdBy: actorUserId,
    }).returning();
  }

  const accountByRef = new Map<string, typeof vendorAccount.$inferSelect>();
  const licenseByName = new Map<string, typeof licenseType.$inferSelect>();
  for (const row of capacityRows) {
    let account = accountByRef.get(row.vendorOrgRef);
    if (!account) {
      [account] = await transaction
        .select()
        .from(vendorAccount)
        .where(and(
          eq(vendorAccount.vendorId, anthropic.id),
          eq(vendorAccount.vendorOrgRef, row.vendorOrgRef),
        ))
        .limit(1);
      if (!account) {
        [account] = await transaction.insert(vendorAccount).values({
          vendorId: anthropic.id,
          name: row.vendorOrgRef,
          mode: "automated",
          vendorOrgRef: row.vendorOrgRef,
          lowPoolFloor: 5,
          status: "active",
          createdAt: occurredAt,
          createdBy: actorUserId,
        }).returning();
        counts.vendorAccounts += 1;
      }
      accountByRef.set(row.vendorOrgRef, account);
    }

    let license = licenseByName.get(row.licenseType);
    if (!license) {
      [license] = await transaction
        .select()
        .from(licenseType)
        .where(and(
          eq(licenseType.vendorId, anthropic.id),
          eq(licenseType.name, row.licenseType),
        ))
        .limit(1);
      if (!license) {
        [license] = await transaction.insert(licenseType).values({
          vendorId: anthropic.id,
          name: row.licenseType,
          unit: "seat",
          status: "active",
          createdAt: occurredAt,
          createdBy: actorUserId,
        }).returning();
        counts.licenseTypes += 1;
      }
      licenseByName.set(row.licenseType, license);
    }

    const [capacity] = await transaction
      .select({ id: vendorAccountCapacity.id })
      .from(vendorAccountCapacity)
      .where(and(
        eq(vendorAccountCapacity.vendorAccountId, account.id),
        eq(vendorAccountCapacity.licenseTypeId, license.id),
        eq(vendorAccountCapacity.effectiveFrom, row.effectiveFrom),
      ))
      .limit(1);
    if (!capacity) {
      await transaction.insert(vendorAccountCapacity).values({
        vendorAccountId: account.id,
        licenseTypeId: license.id,
        purchasedQty: row.purchasedQty,
        effectiveFrom: row.effectiveFrom,
        note: row.note,
        createdAt: occurredAt,
        createdBy: actorUserId,
      });
      counts.capacities += 1;
    }
  }

  for (const credential of credentials) {
    const account = accountByRef.get(credential.vendorOrgRef);
    if (!account) {
      throw new Error(`Credential references unknown vendor org ${credential.vendorOrgRef}`);
    }
    if (!kek) throw new Error("A KEK is required when credentials are supplied");
    const [active] = await transaction
      .select({ id: integrationCredential.id })
      .from(integrationCredential)
      .where(and(
        eq(integrationCredential.vendorAccountId, account.id),
        eq(integrationCredential.kind, credential.kind),
        eq(integrationCredential.status, "active"),
      ))
      .limit(1);
    if (!active) {
      const envelope = await encryptCredential(
        credential.plaintext,
        kek,
        randomBytes,
      );
      await transaction.insert(integrationCredential).values({
        vendorAccountId: account.id,
        kind: credential.kind,
        encryptedSecret: serializeCredentialEnvelope(envelope),
        scopes: credential.scopes,
        last4: credential.plaintext.slice(-4),
        health: "unverified",
        status: "active",
        createdAt: occurredAt,
        createdBy: actorUserId,
      });
      counts.credentials += 1;
    }
  }
  return counts;
}
