import { z } from "zod";

export const STORED_LOCALES = ["es", "en"] as const;
export const APP_LOCALES = ["es-EC", "en-US"] as const;

export const storedLocaleSchema = z.enum(STORED_LOCALES);
export const appLocaleSchema = z.enum(APP_LOCALES);
export const updateLocaleSchema = z.object({
  locale: storedLocaleSchema,
});

export type StoredLocale = z.infer<typeof storedLocaleSchema>;
export type AppLocale = z.infer<typeof appLocaleSchema>;
export type UpdateLocaleInput = z.infer<typeof updateLocaleSchema>;

const appLocaleByStoredLocale: Record<StoredLocale, AppLocale> = {
  es: "es-EC",
  en: "en-US",
};

export function toAppLocale(locale: StoredLocale): AppLocale {
  return appLocaleByStoredLocale[locale];
}
