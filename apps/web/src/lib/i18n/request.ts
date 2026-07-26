import { getRequestConfig } from "next-intl/server";

import { auth } from "@/lib/auth/auth-config";
import { localeService } from "@/modules/identity-access/locale";

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
