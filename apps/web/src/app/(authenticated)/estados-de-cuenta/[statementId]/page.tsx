import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { hasCapability } from "@smp/domain/identity-access";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { statementDetailRepository } from "@/modules/statements/repository";
import { StatementDetailView } from "@/modules/statements/detail-view";
import { loadAppMessages } from "@/lib/i18n/messages";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";

export default async function ScrStatementDetailPage({ params }: { params: Promise<{ statementId: string }> }) {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || !hasCapability(authorization, "finance:read")) redirect(ROUTE_SCR_ACCESS_DENIED);
  const { statementId } = await params;
  const detail = await statementDetailRepository.find(authorization, statementId);
  if (!detail) notFound();
  const locale = await getLocale() === "es-EC" ? "es-EC" : "en-US";
  const messages = await loadAppMessages(locale);
  return <StatementDetailView detail={detail} canViewRegister={authorization.globalRole === "group_admin" || authorization.globalRole === "central_finance"} locale={locale} copy={messages.statementDetail} registerLabels={messages.register} />;
}
