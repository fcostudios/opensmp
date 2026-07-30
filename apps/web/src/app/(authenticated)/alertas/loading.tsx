import { getTranslations } from "next-intl/server";

export default async function AlertsLoading() {
  const t = await getTranslations("alerts");
  return (
    <main aria-busy="true" className="space-y-4 p-4 sm:p-6">
      <p className="text-text-secondary">{t("loading")}</p>
      <div className="h-12 animate-pulse rounded bg-surface-muted" />
      <div className="h-64 animate-pulse rounded bg-surface-muted" />
    </main>
  );
}
