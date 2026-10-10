import { getLocale, getMessages, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UsageView, type UsageLabels } from "@/components/usage/usage-view";
import { ROUTE_SCR_ACCESS_DENIED, ROUTE_SCR_USAGE } from "@/lib/routes";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { parseUsageFilters } from "@/modules/usage/filters";
import { usageRepository, UsageReadError, type UsageReadModel } from "@/modules/usage/repository";

export default async function UsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || authorization.globalRole !== "group_admin") redirect(ROUTE_SCR_ACCESS_DENIED);
  const [locale, messages, t] = await Promise.all([getLocale(), getMessages(), getTranslations("usage")]);
  let model: UsageReadModel;
  try {
    const filters = parseUsageFilters(await searchParams);
    model = await usageRepository.read(authorization, filters, new Date().toISOString().slice(0, 10));
  } catch (error) {
    if (!(error instanceof UsageReadError)) throw error;
    if (error.code === "access_denied") redirect(ROUTE_SCR_ACCESS_DENIED);
    return <main className="space-y-4 p-6"><h1 className="font-display text-3xl font-semibold text-text-primary">{t("title")}</h1><p className="rounded border border-error-dot bg-error-bg p-4 text-error-text" role="alert" data-testid="usage_filter_error">{t("invalidFilter")}</p><Link className="text-primary underline" href={ROUTE_SCR_USAGE}>{t("apply")}</Link></main>;
  }
  return <UsageView model={model} locale={locale} labels={messages.usage as unknown as UsageLabels} />;
}
