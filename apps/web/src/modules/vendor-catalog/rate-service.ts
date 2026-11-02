import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { saveRateCardSchema } from "@smp/contracts/rates";
// eslint-disable-next-line no-restricted-imports -- This audited transaction service owns the global financial catalog.
import * as schema from "@smp/db/schema";
import { withAudit } from "../audit/with-audit";
import type { LedgerAuthorization } from "../identity-access/authorization";

type Database = NodePgDatabase<typeof schema>;
const { rateCard, vendorAccount, licenseType, vendorAccountCapacity } = schema;

function assertAccess(authorization: LedgerAuthorization | null): asserts authorization is LedgerAuthorization {
  // @equivalent: either null-role fallback remains outside this explicit role allowlist.
  if (!authorization || !["group_admin", "central_finance"].includes(authorization.globalRole ?? "")) {
    throw new Error("RATE_ACCESS_FORBIDDEN");
  }
}

export function createRateService(database: Database, { now = () => new Date() }: { now?: () => Date } = {}) {
  return {
    async saveRateCard(authorization: LedgerAuthorization | null, input: unknown) {
      return withAudit(database, async transaction => {
        assertAccess(authorization);
        const command = saveRateCardSchema.parse(input);
        const occurredAt = now();
        // @equivalent: the projection is unused; an empty object still proves the joined pair exists.
        const [pair] = await transaction.select({ vendorId: vendorAccount.vendorId })
          .from(vendorAccount).innerJoin(licenseType, and(eq(licenseType.id, command.licenseTypeId), eq(licenseType.vendorId, vendorAccount.vendorId)))
          .where(and(eq(vendorAccount.id, command.vendorAccountId), eq(vendorAccount.status, "active"), eq(licenseType.status, "active")))
          .for("update", { of: vendorAccount });
        if (!pair) throw new Error("RATE_LICENSE_VENDOR_MISMATCH");
        const before = command.id ? (await transaction.select().from(rateCard).where(and(
          eq(rateCard.id, command.id), eq(rateCard.vendorAccountId, command.vendorAccountId), eq(rateCard.licenseTypeId, command.licenseTypeId),
        )))[0] : null;
        if (command.id && !before) throw new Error("RATE_NOT_FOUND");
        const values = {
          monthlyRateUsd: command.monthlyRateUsd, effectiveFrom: command.effectiveFrom,
          effectiveTo: command.effectiveTo, provisional: command.provisional,
        };
        const [value] = before
          ? (await transaction.execute<typeof rateCard.$inferSelect>(sql`
              SELECT id, vendor_account_id AS "vendorAccountId", license_type_id AS "licenseTypeId",
                monthly_rate_usd AS "monthlyRateUsd", provisional,
                effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo",
                created_at AS "createdAt", created_by AS "createdBy"
              FROM public.edit_unconsumed_rate_card(${before.id}::uuid, ${authorization.userAccountId}::uuid,
                ${command.monthlyRateUsd}::numeric, ${command.effectiveFrom}::date,
                ${command.effectiveTo}::date, ${command.provisional})`)).rows
          : await transaction.insert(rateCard).values({ ...values, vendorAccountId: command.vendorAccountId,
              licenseTypeId: command.licenseTypeId, createdAt: occurredAt, createdBy: authorization.userAccountId }).returning();
        return { value: value!, audit: { actorUserId: authorization.userAccountId,
          action: "rate.saved", entityType: "RateCard", entityId: value!.id,
          companyId: null, note: null, before, after: value! } };
      }, { occurredAt: now() });
    },
    async workspace(authorization: LedgerAuthorization | null) {
      assertAccess(authorization);
      const rates = await database.select({ ...schemaRateColumns(), accountName: vendorAccount.name,
        licenseName: licenseType.name, locked: sql<boolean>`public.rate_card_is_locked(${rateCard})` })
        .from(rateCard).innerJoin(vendorAccount, eq(rateCard.vendorAccountId, vendorAccount.id))
        .innerJoin(licenseType, eq(rateCard.licenseTypeId, licenseType.id)).orderBy(asc(vendorAccount.name), desc(rateCard.effectiveFrom));
      const capacity = await database.select({ id: vendorAccountCapacity.id, accountName: vendorAccount.name,
        licenseName: licenseType.name, purchasedQty: vendorAccountCapacity.purchasedQty,
        effectiveFrom: vendorAccountCapacity.effectiveFrom, note: vendorAccountCapacity.note })
        .from(vendorAccountCapacity).innerJoin(vendorAccount, eq(vendorAccountCapacity.vendorAccountId, vendorAccount.id))
        .innerJoin(licenseType, eq(vendorAccountCapacity.licenseTypeId, licenseType.id)).orderBy(desc(vendorAccountCapacity.effectiveFrom));
      const accounts = await database.select({ id: vendorAccount.id, name: vendorAccount.name, vendorId: vendorAccount.vendorId }).from(vendorAccount).where(eq(vendorAccount.status, "active")).orderBy(asc(vendorAccount.name));
      const licenses = await database.select({ id: licenseType.id, name: licenseType.name, vendorId: licenseType.vendorId }).from(licenseType).where(eq(licenseType.status, "active")).orderBy(asc(licenseType.name));
      return { rates, capacity, accounts, licenses };
    },
  };
}

function schemaRateColumns() {
  return { id: rateCard.id, vendorAccountId: rateCard.vendorAccountId, licenseTypeId: rateCard.licenseTypeId,
    monthlyRateUsd: rateCard.monthlyRateUsd, provisional: rateCard.provisional,
    effectiveFrom: rateCard.effectiveFrom, effectiveTo: rateCard.effectiveTo };
}

export type RatesWorkspace = Awaited<ReturnType<ReturnType<typeof createRateService>["workspace"]>>;
