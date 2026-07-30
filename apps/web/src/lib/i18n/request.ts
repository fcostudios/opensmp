import { getRequestConfig } from "next-intl/server";

import { auth } from "@/lib/auth/auth-config";
import { loadAppMessages } from "@/lib/i18n/messages";
import { localeService } from "@/modules/identity-access/locale";

export default getRequestConfig(async () => {
  const session = await auth();
  const locale = await localeService.resolveLocale(
    session?.user?.uiLanguage ?? null,
  );
  const messages = await loadAppMessages(locale);

  return { locale, messages, timeZone: "America/Guayaquil" };
});
