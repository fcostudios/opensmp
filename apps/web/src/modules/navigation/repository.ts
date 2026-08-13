import {
  and,
  eq,
  inArray,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "@smp/db";
import {
  company,
  licenseRequest,
  person,
  statement,
  vendorAccount,
} from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import type { LedgerSessionUser } from "@/lib/auth/auth-types";
import { matchRoutePolicy } from "@/lib/auth/route-access";
import { BREADCRUMB_PATTERNS } from "@/lib/auth/screen-access.gen";
import type { DynamicBreadcrumbLabels } from "@/components/layout/breadcrumbs";
import { parseVendorAccountId } from "@/modules/vendor-catalog/pool-repository";

type Database = NodePgDatabase<typeof schema>;

function labelsFromPattern(
  route: string,
  values: readonly string[],
): DynamicBreadcrumbLabels {
  const patterns = (
    BREADCRUMB_PATTERNS as Readonly<
      Record<string, readonly string[] | undefined>
    >
  )[route];
  if (!patterns) return {};
  const tokens = patterns.flatMap((pattern) =>
    Array.from(pattern.matchAll(/\{([^}]+)\}/g), (match) => match[1]!),
  );
  if (tokens.length !== values.length) {
    throw new Error(`Breadcrumb query contract mismatch for ${route}`);
  }
  return Object.fromEntries(
    tokens.map((token, index) => [token, values[index]!]),
  );
}

export function createDynamicBreadcrumbRepository(database: Database) {
  return {
    async resolve(
      pathname: string,
      user: LedgerSessionUser,
    ): Promise<DynamicBreadcrumbLabels | null> {
      const match = matchRoutePolicy(pathname);
      if (!match) return null;
      if (!(match.policy.route in BREADCRUMB_PATTERNS)) return {};

      const companyIds = [...user.companyIds];
      switch (match.policy.screenId) {
        case "SCR-company-detail": {
          const id = match.params.companyId;
          if (!id || companyIds.length === 0) return null;
          const [record] = await database
            .select({ name: company.name })
            .from(company)
            .where(
              and(
                eq(company.id, id),
                inArray(company.id, companyIds),
              ),
            )
            .limit(1);
          return record
            ? labelsFromPattern(match.policy.route, [record.name])
            : null;
        }
        case "SCR-person-detail": {
          const id = match.params.personId;
          if (!id || companyIds.length === 0) return null;
          const [record] = await database
            .select({ name: person.fullName })
            .from(person)
            .where(
              and(
                eq(person.id, id),
                inArray(person.companyId, companyIds),
              ),
            )
            .limit(1);
          return record
            ? labelsFromPattern(match.policy.route, [record.name])
            : null;
        }
        case "SCR-request-detail": {
          const id = match.params.requestId;
          if (!id || companyIds.length === 0) return null;
          const [record] = await database
            .select({ requestNo: licenseRequest.requestNo })
            .from(licenseRequest)
            .where(
              and(
                eq(licenseRequest.id, id),
                inArray(licenseRequest.companyId, companyIds),
              ),
            )
            .limit(1);
          return record
            ? labelsFromPattern(match.policy.route, [record.requestNo])
            : null;
        }
        case "SCR-statement-detail": {
          const id = match.params.statementId;
          if (!id || companyIds.length === 0) return null;
          const [record] = await database
            .select({
              companyCode: company.code,
              period: statement.period,
            })
            .from(statement)
            .innerJoin(company, eq(statement.companyId, company.id))
            .where(
              and(
                eq(statement.id, id),
                inArray(statement.companyId, companyIds),
              ),
            )
            .limit(1);
          return record
            ? labelsFromPattern(match.policy.route, [
                record.companyCode,
                record.period,
              ])
            : null;
        }
        case "SCR-vendor-account-detail": {
          if (!user.roles.includes("group_admin")) return null;
          const id = match.params.vendorAccountId;
          if (!id) return null;
          const parsedId = parseVendorAccountId(id);
          if (!parsedId) return labelsFromPattern(match.policy.route, ["…"]);
          const [record] = await database
            .select({ name: vendorAccount.name })
            .from(vendorAccount)
            .where(eq(vendorAccount.id, parsedId))
            .limit(1);
          return record
            ? labelsFromPattern(match.policy.route, [record.name])
            : labelsFromPattern(match.policy.route, ["…"]);
        }
        default:
          return null;
      }
    },
  };
}

export const dynamicBreadcrumbRepository =
  createDynamicBreadcrumbRepository(db as unknown as Database);
