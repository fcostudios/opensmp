import { useTranslations } from "next-intl";
export default function UsageLoading() {
  const t = useTranslations("usage");
  return <section className="space-y-4 p-6" data-testid="usage_loading" aria-live="polite" aria-busy="true" role="status"><p className="text-text-secondary">{t("loading")}</p><div className="grid gap-4 md:grid-cols-3" aria-hidden="true">{[0,1,2].map(key => <div className="h-24 animate-pulse rounded bg-surface-alt" key={key} />)}</div><div className="h-64 animate-pulse rounded bg-surface-alt" aria-hidden="true" /></section>;
}
