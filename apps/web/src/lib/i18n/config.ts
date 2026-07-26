import {
  storedLocaleSchema,
  toAppLocale,
  type AppLocale,
} from "@smp/contracts";

export const DEFAULT_APP_LOCALE: AppLocale = "es-EC";

export function resolveAppLocale({
  userUiLanguage,
  systemDefaultLanguage,
}: {
  userUiLanguage: unknown;
  systemDefaultLanguage: unknown;
}): AppLocale {
  const userLocale = storedLocaleSchema.safeParse(userUiLanguage);
  if (userLocale.success) return toAppLocale(userLocale.data);

  const systemLocale = storedLocaleSchema.safeParse(systemDefaultLanguage);
  return systemLocale.success
    ? toAppLocale(systemLocale.data)
    : DEFAULT_APP_LOCALE;
}
