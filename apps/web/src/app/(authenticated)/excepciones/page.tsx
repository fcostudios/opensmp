import { ExceptionsView } from "./exceptions-view";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { createOrchestrationService } from "@/modules/request-workflow/orchestration";
import { requestReadRepository } from "@/modules/request-workflow/repository";
import { formatOperationalBadgeCount } from "@/modules/operational-alert-read";

import { retryErrorMessageKey } from "./retry-labels";

const tabs = ["blocked", "failed", "drift", "expiredInvites"] as const;
type ExceptionTab = (typeof tabs)[number];

function activeTab(value: string | undefined): ExceptionTab {
  return tabs.find((tab) => tab === value) ?? "blocked";
}

export default async function ScrExceptionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly cursor?: string;
    readonly retryError?: string;
    readonly tab?: string;
  }>;
}) {
  const [authorization, locale, pages, orchestration, t, query] =
    await Promise.all([
      loadCurrentLedgerAuthorization(),
      getLocale(),
      getTranslations("pages"),
      getTranslations("orchestration"),
      getTranslations("exceptions"),
      searchParams,
    ]);
  if (!authorization || authorization.globalRole !== "group_admin") {
    redirect("/acceso-denegado");
  }
  const selected = activeTab(query.tab);
  const invitationAt = new Date();
  const invitationCount = await requestReadRepository.countOverdueInvitations(
    authorization,
    invitationAt,
  );
  const invitations = selected === "expiredInvites"
    ? await requestReadRepository.listOverdueInvitations(authorization, {
        at: invitationAt,
        cursor: query.cursor,
      })
    : { items: [], nextCursor: null };
  const exceptionCounts =
    await requestReadRepository.countOperationalExceptions(authorization);
  const blocked =
    selected === "blocked"
      ? await requestReadRepository.listBlockedExceptions(authorization, {
          cursor: query.cursor,
        })
      : { items: [], nextCursor: null };
  let failures: Awaited<
    ReturnType<
      ReturnType<typeof createOrchestrationService>["verificationFailures"]
    >
  > = { items: [], nextCursor: null };
  if (selected === "failed") {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const service = createOrchestrationService(process.env.DATABASE_URL);
    try {
      failures = await service.verificationFailures(authorization, {
        cursor: query.cursor,
      });
    } finally {
      await service.close();
    }
  }
  const retryErrorKey = retryErrorMessageKey(query.retryError);
  const counts: Record<ExceptionTab, string> = {
    blocked: formatOperationalBadgeCount(
      exceptionCounts.blocked,
      t("countOverflow"),
    ),
    drift: "0",
    expiredInvites: formatOperationalBadgeCount(
      invitationCount,
      t("countOverflow"),
    ),
    failed: formatOperationalBadgeCount(
      exceptionCounts.failed,
      t("countOverflow"),
    ),
  };

  return (
    <ExceptionsView
      selected={selected}
      blocked={blocked}
      invitations={invitations}
      failures={failures}
      retryErrorKey={retryErrorKey}
      counts={counts}
      locale={locale}
      title={pages("excepciones.title")}
      orchestration={orchestration}
      t={t}
    />
  );
}
