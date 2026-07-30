import { getLocale, getMessages } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { hasCapability } from "@smp/domain/identity-access";

import {
  PersonFreshness,
  assignmentEndReasonLabel,
  assignmentSourceLabel,
  type AssignmentLabelCatalog,
} from "@/components/people/person-detail-presenters";
import {
  PersonForm,
  type PersonFormLabels,
} from "@/components/people/person-form";
import {
  PersonOffboarding,
  type PersonOffboardingLabels,
} from "@/components/people/person-offboarding";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import {
  startOffboarding,
  updatePerson,
} from "@/modules/org-registry/actions/people";
import {
  PeopleRepositoryError,
  peopleRepository,
} from "@/modules/org-registry/repository";

interface DetailLabels
  extends PersonFormLabels,
    PersonOffboardingLabels,
    AssignmentLabelCatalog {
  readonly activityDescription: string;
  readonly activityHistory: string;
  readonly activitySummary: string;
  readonly assignmentDescription: string;
  readonly assignmentHistory: string;
  readonly currentLicense: string;
  readonly currentLicenseCaption: string;
  readonly dataUnavailable: string;
  readonly date: string;
  readonly detailBack: string;
  readonly editPerson: string;
  readonly endReason: string;
  readonly from: string;
  readonly inactiveDays: string;
  readonly inactiveWindow: string;
  readonly lastUse: string;
  readonly noActivity: string;
  readonly noAssignments: string;
  readonly offboardingDescription: string;
  readonly offboardingNote: string;
  readonly offboardingNotePlaceholder: string;
  readonly offboardingReason: string;
  readonly offboardingTitle: string;
  readonly openEnded: string;
  readonly requestLicense: string;
  readonly source: string;
  readonly startOffboarding: string;
  readonly summary: string;
  readonly synced: string;
  readonly through: string;
  readonly viewRegister: string;
  readonly viewSourceRequest: string;
  readonly leftCompany: string;
  readonly inactive: string;
  readonly reallocated: string;
  readonly confirmOffboarding: string;
  readonly freshnessStale: string;
}

function formatCounters(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, counter]) => `${key}: ${String(counter)}`)
      .join(" · ");
  }
  return String(value);
}

export default async function PersonDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly personId: string }>;
}) {
  const renderedAt = new Date();
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || !hasCapability(authorization, "admin:manage")) {
    redirect("/acceso-denegado");
  }
  const { personId } = await params;
  let detail;
  try {
    detail = await peopleRepository.detail(authorization, personId);
  } catch (error) {
    if (
      error instanceof PeopleRepositoryError &&
      error.code === "person_not_found"
    ) {
      notFound();
    }
    throw error;
  }
  const [companies, locale, messages] = await Promise.all([
    peopleRepository.companies(authorization),
    getLocale(),
    getMessages(),
  ]);
  const labels = messages.people as unknown as DetailLabels;
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const lastUse = detail.lastActiveOn
    ? new Date(`${detail.lastActiveOn}T00:00:00.000Z`)
    : null;
  const inactiveDays = lastUse
    ? Math.max(
        0,
        Math.floor(
          ((detail.freshnessAt?.getTime() ?? lastUse.getTime()) -
            lastUse.getTime()) /
            86_400_000,
        ),
      )
    : null;

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <Link className="text-sm font-semibold text-primary" href="/personas">
          ← {labels.detailBack}
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase text-text-primary">
          {detail.fullName}
        </h1>
        <p className="font-mono text-sm text-text-secondary">
          {detail.email} · {detail.companyName} ·{" "}
          {detail.status === "active" ? labels.active : labels.departed}
        </p>
      </header>

      <section data-testid="person_tiles">
        <h2 className="sr-only">{labels.summary}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <article className="rounded border border-border bg-surface p-4" data-testid="tile_current_license">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {labels.currentLicense}
            </p>
            <p className="mt-2 font-display text-2xl font-semibold text-text-primary">
              {detail.currentLicense ?? labels.dataUnavailable}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {labels.currentLicenseCaption}
            </p>
          </article>
          <article className="rounded border border-border bg-surface p-4" data-testid="tile_last_use">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {labels.lastUse}
            </p>
            <p className="mt-2 font-display text-2xl font-semibold text-text-primary">
              {lastUse ? dateFormat.format(lastUse) : labels.dataUnavailable}
            </p>
            <p className="mt-1 text-sm">
              <PersonFreshness
                locale={locale as "es-EC" | "en-US"}
                now={renderedAt}
                staleLabel={labels.freshnessStale}
                syncedAt={detail.freshnessAt}
                syncedLabel={labels.synced}
                unavailableLabel={labels.dataUnavailable}
              />
            </p>
          </article>
          <article className="rounded border border-border bg-surface p-4" data-testid="tile_inactive_days">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {labels.inactiveDays}
            </p>
            <p className="mt-2 font-display text-2xl font-semibold text-text-primary">
              {inactiveDays ?? labels.dataUnavailable}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {labels.inactiveWindow}
            </p>
          </article>
        </div>
      </section>

      <section
        className="rounded border border-border bg-surface p-4"
        data-testid="assignment_history"
      >
        <h2 className="font-display text-xl font-semibold text-text-primary">
          {labels.assignmentHistory}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {labels.assignmentDescription}
        </p>
        {detail.assignmentHistory.length === 0 ? (
          <p className="mt-4 text-text-muted">{labels.noAssignments}</p>
        ) : (
          <ol className="mt-4 divide-y divide-border border-y border-border">
            {detail.assignmentHistory.map((assignment) => (
              <li className="grid gap-2 py-4 md:grid-cols-[11rem_1fr_auto]" key={assignment.id}>
                <time className="font-mono text-sm text-text-muted">
                  {dateFormat.format(new Date(`${assignment.startedOn}T00:00:00.000Z`))}
                  {" — "}
                  {assignment.endedOn
                    ? dateFormat.format(new Date(`${assignment.endedOn}T00:00:00.000Z`))
                    : labels.openEnded}
                </time>
                <div>
                  <p className="font-semibold text-text-primary">
                    {assignment.licenseTypeName} · {assignment.vendorAccountName}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {assignment.companyName} · {labels.source}:{" "}
                    {assignmentSourceLabel(assignment.sourceKind, labels)}
                    {assignment.endReason
                      ? ` · ${labels.endReason}: ${assignmentEndReasonLabel(
                          assignment.endReason,
                          labels,
                        )}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-3 text-sm font-semibold">
                  <Link className="text-primary" href="/registro">
                    {labels.viewRegister}
                  </Link>
                  {assignment.sourceRequestId ? (
                    <Link className="text-primary" href={`/solicitudes/${assignment.sourceRequestId}`}>
                      {labels.viewSourceRequest}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="overflow-hidden rounded border border-border bg-surface"
        data-testid="activity_table"
      >
        <div className="border-b border-border p-4">
          <h2 className="font-display text-xl font-semibold text-text-primary">
            {labels.activityHistory}
          </h2>
          <p className="text-sm text-text-secondary">{labels.activityDescription}</p>
        </div>
        {detail.activityHistory.length === 0 ? (
          <p className="p-4 text-text-muted">{labels.noActivity}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-sm text-text-secondary">
                  <th className="p-3">{labels.date}</th>
                  <th className="p-3">{labels.activitySummary}</th>
                  <th className="p-3">{labels.synced}</th>
                </tr>
              </thead>
              <tbody>
                {detail.activityHistory.map((activity) => (
                  <tr className="border-b border-border" key={activity.id}>
                    <td className="p-3 font-mono text-sm">
                      {dateFormat.format(new Date(`${activity.activityDate}T00:00:00.000Z`))}
                    </td>
                    <td className="p-3">{formatCounters(activity.counters)}</td>
                    <td className="p-3 text-sm text-text-secondary">
                      {dateFormat.format(activity.syncedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3" data-testid="person_actions">
        <Link
          className="min-h-11 rounded bg-primary px-4 py-3 text-center font-semibold text-text-on-primary"
          data-testid="btn_request_license"
          href={`/solicitudes/nueva?personId=${detail.id}`}
        >
          {labels.requestLicense}
        </Link>
        <PersonOffboarding
          action={startOffboarding}
          labels={labels}
          personId={detail.id}
        />
        <details className="rounded border border-border bg-surface p-3">
          <summary className="cursor-pointer font-semibold" data-testid="btn_editar_persona">
            {labels.editPerson}
          </summary>
          <div className="mt-4" data-testid="modal_editar_persona">
            <PersonForm
              action={updatePerson}
              companies={companies}
              labels={labels}
              mode="edit"
              person={{
                id: detail.id,
                fullName: detail.fullName,
                email: detail.email,
                companyId: detail.companyId,
                status: detail.status,
              }}
            />
          </div>
        </details>
      </section>
    </main>
  );
}
