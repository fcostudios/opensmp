import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  updateLocaleSchema,
  type AppLocale,
  type UpdateLocaleInput,
} from "@smp/contracts";
import { db } from "@smp/db";
import { auditLog, systemSetting, userAccount } from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import { resolveAppLocale } from "@/lib/i18n/config";

type Database = NodePgDatabase<typeof schema>;

export class LocaleUpdateError extends Error {
  constructor(readonly code: "unauthorized" | "account_unavailable") {
    super(`Locale update rejected: ${code}`);
    this.name = "LocaleUpdateError";
  }
}

export function createLocaleService(database: Database) {
  return {
    async resolveLocale(userUiLanguage: unknown): Promise<AppLocale> {
      if (userUiLanguage === "es" || userUiLanguage === "en") {
        return resolveAppLocale({
          userUiLanguage,
          systemDefaultLanguage: null,
        });
      }
      const [setting] = await database
        .select({ value: systemSetting.value })
        .from(systemSetting)
        .where(eq(systemSetting.key, "default_language"))
        .limit(1);
      return resolveAppLocale({
        userUiLanguage,
        systemDefaultLanguage: setting?.value,
      });
    },

    async updateLocale(
      actorUserId: string | null,
      input: UpdateLocaleInput,
      occurredAt = new Date(),
    ): Promise<void> {
      const { locale } = updateLocaleSchema.parse(input);
      if (!actorUserId) throw new LocaleUpdateError("unauthorized");

      await database.transaction(async (transaction) => {
        const [actor] = await transaction
          .select({
            id: userAccount.id,
            status: userAccount.status,
            uiLanguage: userAccount.uiLanguage,
          })
          .from(userAccount)
          .where(eq(userAccount.id, actorUserId))
          .limit(1)
          .for("update");
        if (!actor || actor.status !== "active") {
          throw new LocaleUpdateError("account_unavailable");
        }

        await transaction
          .update(userAccount)
          .set({ uiLanguage: locale })
          .where(eq(userAccount.id, actor.id));
        await transaction.insert(auditLog).values({
          actorUserId: actor.id,
          action: "user_account.ui_language.updated",
          entityType: "user_account",
          entityId: actor.id,
          before: { ui_language: actor.uiLanguage },
          after: { ui_language: locale },
          occurredAt,
        });
      });
    },
  };
}

export const localeService = createLocaleService(
  db as unknown as Database,
);
