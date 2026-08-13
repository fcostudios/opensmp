// eslint-disable-next-line no-restricted-imports -- This repository consumes the canonical pool read boundary.
import { listCurrentSeatPoolCounts } from "@smp/db/pool-snapshots";
import pg from "pg";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { parseVendorAccountId, poolOperatingDate } from "./pool-repository";

export interface VendorAccountListItem {
  readonly id: string;
  readonly name: string;
  readonly vendorName: string;
  readonly connectorType: "api" | "orchestration" | "manual";
  readonly provisioningProtocol: "rest" | "scim" | "none";
  readonly mode: "automated" | "orchestration";
  readonly purchased: number;
  readonly free: number;
  readonly contractRenewalOn: string | null;
  readonly credentialHealth: "ok" | "auth_failed" | "unverified" | null;
  readonly lowPoolFloor: number;
  readonly status: "active" | "inactive";
}

export interface VendorAccountDetail extends VendorAccountListItem {
  readonly vendorId: string;
  readonly vendorOrgRef: string | null;
  readonly capabilities: {
    readonly canProvision: boolean;
    readonly canDeprovision: boolean;
    readonly hasUsageData: boolean;
    readonly hasCostData: boolean;
    readonly provisioningProtocol: "rest" | "scim" | "none";
    readonly identityMatching: "email" | "upn" | "vendor_user_id";
  };
  readonly licenseTypes: readonly {
    readonly id: string;
    readonly name: string;
    readonly unit: "seat" | "license";
    readonly status: "active" | "inactive";
    readonly monthlyRateUsd: string | null;
    readonly rateEffectiveFrom: string | null;
    readonly rateEffectiveTo: string | null;
  }[];
}

interface AccountRow {
  readonly canDeprovision: boolean;
  readonly canProvision: boolean;
  readonly connectorType: VendorAccountListItem["connectorType"];
  readonly contractRenewalOn: string | null;
  readonly credentialHealth: VendorAccountListItem["credentialHealth"];
  readonly hasCostData: boolean;
  readonly hasUsageData: boolean;
  readonly id: string;
  readonly identityMatching: VendorAccountDetail["capabilities"]["identityMatching"];
  readonly lowPoolFloor: number;
  readonly mode: VendorAccountListItem["mode"];
  readonly name: string;
  readonly provisioningProtocol: VendorAccountListItem["provisioningProtocol"];
  readonly status: VendorAccountListItem["status"];
  readonly vendorId: string;
  readonly vendorName: string;
  readonly vendorOrgRef: string | null;
}

interface LicenseTypeRow {
  readonly id: string;
  readonly monthlyRateUsd: string | null;
  readonly name: string;
  readonly rateEffectiveFrom: string | null;
  readonly rateEffectiveTo: string | null;
  readonly status: "active" | "inactive";
  readonly unit: "seat" | "license";
}

function assertVendorAccountAccess(authorization: LedgerAuthorization): void {
  if (authorization.globalRole !== "group_admin") {
    throw new Error("VENDOR_ACCOUNT_ACCESS_FORBIDDEN");
  }
}

function aggregatePoolTotals(
  snapshots: Awaited<ReturnType<typeof listCurrentSeatPoolCounts>>,
): ReadonlyMap<string, { readonly free: number; readonly purchased: number }> {
  const totals = new Map<string, { free: number; purchased: number }>();
  for (const snapshot of snapshots) {
    const current = totals.get(snapshot.vendorAccountId) ?? {
      free: 0,
      purchased: 0,
    };
    totals.set(snapshot.vendorAccountId, {
      free:
        current.free +
        snapshot.purchased -
        snapshot.assigned -
        snapshot.pendingInvites,
      purchased: current.purchased + snapshot.purchased,
    });
  }
  return totals;
}

function toListItem(
  row: AccountRow,
  totals: ReadonlyMap<
    string,
    { readonly free: number; readonly purchased: number }
  >,
): VendorAccountListItem {
  const accountTotals = totals.get(row.id) ?? { free: 0, purchased: 0 };
  return {
    connectorType: row.connectorType,
    contractRenewalOn: row.contractRenewalOn,
    credentialHealth: row.credentialHealth,
    free: accountTotals.free,
    id: row.id,
    lowPoolFloor: Number(row.lowPoolFloor),
    mode: row.mode,
    name: row.name,
    provisioningProtocol: row.provisioningProtocol,
    purchased: accountTotals.purchased,
    status: row.status,
    vendorName: row.vendorName,
  };
}

export function createVendorAccountRepository(connectionString: string) {
  const pool = new pg.Pool({ connectionString });

  async function loadAccounts(
    at: Date,
    vendorAccountId?: string,
  ): Promise<{
    readonly rows: readonly AccountRow[];
    readonly totals: ReadonlyMap<
      string,
      { readonly free: number; readonly purchased: number }
    >;
  }> {
    const operatingDate = poolOperatingDate(at);
    const [accounts, snapshots] = await Promise.all([
      pool.query<AccountRow>(
        `SELECT account.id::text AS id,
                account.vendor_id::text AS "vendorId",
                account.name,
                account.mode,
                account.vendor_org_ref AS "vendorOrgRef",
                account.contract_renewal_on::text AS "contractRenewalOn",
                account.low_pool_floor::int AS "lowPoolFloor",
                account.status,
                vendor.name AS "vendorName",
                vendor.connector_type AS "connectorType",
                vendor.provisioning_protocol AS "provisioningProtocol",
                vendor.can_provision AS "canProvision",
                vendor.can_deprovision AS "canDeprovision",
                vendor.has_usage_data AS "hasUsageData",
                vendor.has_cost_data AS "hasCostData",
                vendor.identity_matching AS "identityMatching",
                credential.health AS "credentialHealth"
         FROM vendor_account account
         JOIN vendor ON vendor.id = account.vendor_id
         LEFT JOIN LATERAL (
           SELECT CASE max(CASE active.health
                              WHEN 'auth_failed' THEN 3
                              WHEN 'unverified' THEN 2
                              WHEN 'ok' THEN 1
                            END)
                    WHEN 3 THEN 'auth_failed'::integration_credential_health_enum
                    WHEN 2 THEN 'unverified'::integration_credential_health_enum
                    WHEN 1 THEN 'ok'::integration_credential_health_enum
                  END AS health
           FROM integration_credential active
           WHERE active.vendor_account_id = account.id
             AND active.status = 'active'
         ) credential ON TRUE
         WHERE ($1::uuid IS NULL OR account.id = $1)
         ORDER BY account.status, lower(account.name), account.id`,
        [vendorAccountId ?? null],
      ),
      listCurrentSeatPoolCounts(pool, {
        asOf: at,
        operatingDate,
        vendorAccountId,
      }),
    ]);
    return { rows: accounts.rows, totals: aggregatePoolTotals(snapshots) };
  }

  return {
    async activeAnthropicOptions(
      authorization: LedgerAuthorization,
    ): Promise<readonly { readonly id: string; readonly name: string }[]> {
      assertVendorAccountAccess(authorization);
      const result = await pool.query<{ readonly id: string; readonly name: string }>(
        `SELECT id::text, name
         FROM vendor
         WHERE status = 'active'
           AND lower(name) = 'anthropic'
         ORDER BY lower(name), id`,
      );
      return result.rows;
    },

    async close(): Promise<void> {
      await pool.end();
    },

    async detail(
      authorization: LedgerAuthorization,
      vendorAccountId: string,
      at: Date,
    ): Promise<VendorAccountDetail | null> {
      assertVendorAccountAccess(authorization);
      const parsedId = parseVendorAccountId(vendorAccountId);
      if (!parsedId) return null;

      const { rows, totals } = await loadAccounts(at, parsedId);
      const account = rows[0];
      if (!account) return null;
      const operatingDate = poolOperatingDate(at);
      const licenseTypes = await pool.query<LicenseTypeRow>(
        `SELECT license.id::text,
                license.name,
                license.unit,
                license.status,
                current_rate.monthly_rate_usd::text AS "monthlyRateUsd",
                current_rate.effective_from::text AS "rateEffectiveFrom",
                current_rate.effective_to::text AS "rateEffectiveTo"
         FROM license_type license
         LEFT JOIN LATERAL (
           SELECT rate.monthly_rate_usd, rate.effective_from, rate.effective_to
           FROM rate_card rate
           WHERE rate.vendor_account_id = $1::uuid
             AND rate.license_type_id = license.id
             AND rate.effective_from <= $2::date
             AND (rate.effective_to IS NULL OR rate.effective_to >= $2::date)
           ORDER BY rate.effective_from DESC, rate.id DESC
           LIMIT 1
         ) current_rate ON TRUE
         WHERE license.vendor_id = $3::uuid
         ORDER BY lower(license.name), license.id`,
        [parsedId, operatingDate, account.vendorId],
      );
      return {
        ...toListItem(account, totals),
        capabilities: {
          canDeprovision: account.canDeprovision,
          canProvision: account.canProvision,
          hasCostData: account.hasCostData,
          hasUsageData: account.hasUsageData,
          identityMatching: account.identityMatching,
          provisioningProtocol: account.provisioningProtocol,
        },
        licenseTypes: licenseTypes.rows,
        vendorId: account.vendorId,
        vendorOrgRef: account.vendorOrgRef,
      };
    },

    async list(
      authorization: LedgerAuthorization,
      at: Date,
    ): Promise<readonly VendorAccountListItem[]> {
      assertVendorAccountAccess(authorization);
      const { rows, totals } = await loadAccounts(at);
      return rows.map((row) => toListItem(row, totals));
    },
  };
}

export type VendorAccountRepository = ReturnType<
  typeof createVendorAccountRepository
>;
