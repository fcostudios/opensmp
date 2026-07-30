import {
  getNotificationCatalog,
  notificationCatalogs,
} from "@smp/notifications/catalog";

export async function loadAppMessages(locale: unknown) {
  const canonical = getNotificationCatalog(locale);
  const appMessages =
    canonical === notificationCatalogs["en-US"]
      ? (await import("../../../messages/en-US.json")).default
      : (await import("../../../messages/es-EC.json")).default;

  return {
    ...appMessages,
    lifecycle: canonical.lifecycle,
    status: canonical.status,
  };
}
