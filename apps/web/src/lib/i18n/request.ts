import { getRequestConfig } from "next-intl/server";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "@smp/db";
import * as schema from "@smp/db/schema";

import { auth } from "@/lib/auth/auth-config";
import { createLocaleService } from "@/modules/identity-access/locale";

const localeService = createLocaleService(
  db as unknown as NodePgDatabase<typeof schema>,
);

export default getRequestConfig(async () => {
  const session = await auth();
  const locale = await localeService.resolveLocale(
    session?.user?.uiLanguage ?? null,
  );
  const messages =
    locale === "en-US"
      ? (await import("../../../messages/en-US.json")).default
      : (await import("../../../messages/es-EC.json")).default;

  return { locale, messages, timeZone: "America/Guayaquil" };
});
