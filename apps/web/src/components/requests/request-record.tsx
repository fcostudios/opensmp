import type { ReactNode } from "react";
import Link from "next/link";

import {
  StateTimeline,
  StatusPill,
  type RequestStatus,
} from "@smp/ui";

import type { RequestRecordProjection } from "@/modules/request-workflow/read-repository";
import { PayloadDialog } from "./payload-dialog";

export type RequestRecordTab = "actions" | "assignment" | "audit";

export interface RequestRecordLabels {
  readonly actionKind: Readonly<
    Record<RequestRecordProjection["actions"][number]["kind"], string>
  >;
  readonly actionMode: Readonly<
    Record<RequestRecordProjection["actions"][number]["mode"], string>
  >;
  readonly actionStatus: Readonly<
    Record<RequestRecordProjection["actions"][number]["status"], string>
  >;
  readonly actions: string;
  readonly actionsEmpty: string;
  readonly assignment: string;
  readonly assignmentActive: string;
  readonly assignmentEmpty: string;
  readonly assignmentEnded: string;
  readonly audit: string;
  readonly auditEmpty: string;
  readonly blockedBody: string;
  readonly blockedTitle: string;
  readonly company: string;
  readonly closePayload: string;
  readonly daysInState: string;
  readonly decisionComment: string;
  readonly endedOn: string;
  readonly failedBody: string;
  readonly failedTitle: string;
  readonly failureReason: string;
  readonly justification: string;
  readonly kind: string;
  readonly neededBy: string;
  readonly noDate: string;
  readonly noPayloadResponse: string;
  readonly organization: string;
  readonly rawPayload: string;
  readonly rawRequest: string;
  readonly rawResponse: string;
  readonly request: string;
  readonly requestedBy: string;
  readonly resolvedAt: string;
  readonly sentAt: string;
  readonly startedOn: string;
  readonly state: string;
  readonly stateHistory: string;
  readonly systemActor: string;
  readonly vendorReference: string;
  readonly viewPools: string;
  readonly viewRegister: string;
}

function dateFormatter(locale: "es-EC" | "en-US") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

function dateTimeFormatter(locale: "es-EC" | "en-US") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Guayaquil",
  });
}

export function formatTimelineDateTime(
  value: string,
  locale: "es-EC" | "en-US",
) {
  return dateTimeFormatter(locale).format(new Date(value));
}

function formatDate(
  value: string | null,
  locale: "es-EC" | "en-US",
  fallback: string,
) {
  return value
    ? dateFormatter(locale).format(
        new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`),
      )
    : fallback;
}

function formatDateTime(
  value: string | null,
  locale: "es-EC" | "en-US",
  fallback: string,
) {
  return value ? dateTimeFormatter(locale).format(new Date(value)) : fallback;
}

function TabLink({
  badge,
  children,
  id,
  selected,
  tab,
}: {
  readonly badge: number;
  readonly children: ReactNode;
  readonly id: string;
  readonly selected: boolean;
  readonly tab: RequestRecordTab;
}) {
  return (
    <Link
      aria-current={selected ? "page" : undefined}
      className={
        selected
          ? "inline-flex min-h-11 items-center gap-2 border-b-2 border-primary px-3 font-semibold text-text-primary"
          : "inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent px-3 text-text-secondary hover:text-text-primary"
      }
      data-testid={id}
      href={`?tab=${tab}`}
      id={id}
    >
      {children}
      <span className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs">
        {badge}
      </span>
    </Link>
  );
}

export function RequestRecord({
  activeTab,
  checklist,
  decisionActions,
  feedback,
  isGroupAdmin,
  labels,
  locale,
  record,
  statusLabels,
}: {
  readonly activeTab: RequestRecordTab;
  readonly checklist?: ReactNode;
  readonly decisionActions?: ReactNode;
  readonly feedback?: ReactNode;
  readonly isGroupAdmin: boolean;
  readonly labels: RequestRecordLabels;
  readonly locale: "es-EC" | "en-US";
  readonly record: RequestRecordProjection;
  readonly statusLabels: Readonly<Record<RequestStatus, string>>;
}) {
  const resolvedTab =
    (activeTab === "audit" && !isGroupAdmin) ||
    (activeTab === "assignment" && !record.assignment)
      ? "actions"
      : activeTab;
  const timeline = record.timeline.map((item) => ({
    ...item,
    actor: item.actor ?? labels.systemActor,
    from: item.from
      ? (statusLabels[item.from as RequestStatus] ?? item.from)
      : null,
    occurredAt: item.occurredAt,
    occurredAtLabel: formatTimelineDateTime(item.occurredAt, locale),
    to: statusLabels[item.to as RequestStatus] ?? item.to,
  }));

  return (
    <div className="space-y-5">
      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
              {labels.request} · {record.requestNo}
            </p>
            <h1 className="font-display text-3xl font-semibold text-text-primary">
              {record.person.fullName} · {record.licenseType.name}
            </h1>
            <p className="mt-1 text-text-secondary">
              {record.company.name} ({record.company.code}) ·{" "}
              {record.vendorAccount.name}
              {record.requestedBy
                ? ` · ${labels.requestedBy} ${record.requestedBy}`
                : null}
            </p>
          </div>
          <StatusPill
            label={statusLabels[record.state]}
            status={record.state}
          />
        </div>
      </header>

      {feedback}
      {decisionActions}

      <section
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-testid="request_tiles"
      >
        <Metric
          id="tile_estado"
          label={labels.state}
          value={statusLabels[record.state]}
        />
        <Metric
          id="tile_dias_en_estado"
          label={labels.daysInState}
          value={String(record.stateAgeDays)}
        />
        <Metric
          id="tile_needed_by"
          label={labels.neededBy}
          value={formatDate(record.neededBy, locale, labels.noDate)}
        />
        <Metric
          caption={record.company.code}
          id="tile_compania"
          label={labels.company}
          value={record.company.name}
        />
      </section>

      {record.state === "blocked_no_seat" ? (
        <section
          className="rounded-lg border border-pending-dot bg-pending-bg p-4 text-pending-text"
          data-testid="banner_blocked"
        >
          <h2 className="font-display text-xl font-semibold">
            {labels.blockedTitle}
          </h2>
          <p className="mt-1">{labels.blockedBody}</p>
          {isGroupAdmin ? (
            <Link
              className="mt-3 inline-flex min-h-11 items-center rounded bg-primary px-4 font-semibold text-text-on-primary"
              data-testid="btn_ver_cupos"
              href="/cupos"
            >
              {labels.viewPools}
            </Link>
          ) : null}
        </section>
      ) : null}

      {record.state === "failed" ? (
        <section
          className="rounded-lg border border-error-dot bg-error-bg p-4 text-error-text"
          data-testid="banner_failed"
        >
          <h2 className="font-display text-xl font-semibold">
            {labels.failedTitle}
          </h2>
          <p className="mt-1">{labels.failedBody}</p>
        </section>
      ) : null}

      <section
        className="rounded-lg border border-border bg-surface p-4"
        data-testid="justificacion_card"
      >
        <h2 className="font-display text-xl font-semibold text-text-primary">
          {labels.justification}
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-text-secondary">
          {record.justification}
        </p>
        {record.decisionComment ? (
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="text-sm font-semibold text-text-secondary">
              {labels.decisionComment}
            </h3>
            <p className="mt-1 text-text-primary">{record.decisionComment}</p>
          </div>
        ) : null}
      </section>

      {checklist}

      <section
        className="rounded-lg border border-border bg-surface p-4"
        data-testid="state_timeline"
      >
        <h2 className="mb-4 font-display text-xl font-semibold text-text-primary">
          {labels.stateHistory}
        </h2>
        <StateTimeline items={timeline} />
      </section>

      <section
        className="overflow-hidden rounded-lg border border-border bg-surface"
        data-testid="record_tabs"
      >
        <nav
          aria-label={labels.request}
          className="flex overflow-x-auto border-b border-border px-2"
        >
          <TabLink
            badge={record.actions.length}
            id="tab_acciones"
            selected={resolvedTab === "actions"}
            tab="actions"
          >
            {labels.actions}
          </TabLink>
          {record.assignment ? (
            <TabLink
              badge={1}
              id="tab_asignacion"
              selected={resolvedTab === "assignment"}
              tab="assignment"
            >
              {labels.assignment}
            </TabLink>
          ) : null}
          {isGroupAdmin ? (
            <TabLink
              badge={record.audit.length}
              id="tab_auditoria"
              selected={resolvedTab === "audit"}
              tab="audit"
            >
              {labels.audit}
            </TabLink>
          ) : null}
        </nav>

        {resolvedTab === "actions" ? (
          <ActionsPanel
            isGroupAdmin={isGroupAdmin}
            labels={labels}
            locale={locale}
            record={record}
          />
        ) : null}
        {resolvedTab === "assignment" ? (
          <AssignmentPanel labels={labels} locale={locale} record={record} />
        ) : null}
        {resolvedTab === "audit" && isGroupAdmin ? (
          <AuditPanel labels={labels} locale={locale} record={record} />
        ) : null}
      </section>
    </div>
  );
}

function Metric({
  caption,
  id,
  label,
  value,
}: {
  readonly caption?: string;
  readonly id: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <article
      className="min-w-0 rounded-lg border border-border bg-surface p-4"
      data-testid={id}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <p className="mt-2 truncate font-display text-2xl font-semibold text-text-primary">
        {value}
      </p>
      {caption ? (
        <p className="mt-1 font-mono text-xs text-text-muted">{caption}</p>
      ) : null}
    </article>
  );
}

function ActionsPanel({
  isGroupAdmin,
  labels,
  locale,
  record,
}: {
  readonly isGroupAdmin: boolean;
  readonly labels: RequestRecordLabels;
  readonly locale: "es-EC" | "en-US";
  readonly record: RequestRecordProjection;
}) {
  return (
    <section
      aria-labelledby="tab_acciones"
      className="overflow-x-auto p-4"
      data-testid="acciones_table"
      id="panel_actions"
    >
      {record.actions.length === 0 ? (
        <p className="py-8 text-center text-text-secondary">
          {labels.actionsEmpty}
        </p>
      ) : (
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="text-text-secondary">
            <tr>
              <th className="pb-3 font-semibold" scope="col">{labels.kind}</th>
              <th className="pb-3 font-semibold" scope="col">{labels.state}</th>
              <th className="pb-3 font-semibold" scope="col">{labels.vendorReference}</th>
              <th className="pb-3 font-semibold" scope="col">{labels.sentAt}</th>
              <th className="pb-3 font-semibold" scope="col">{labels.resolvedAt}</th>
              <th className="pb-3 font-semibold" scope="col">{labels.failureReason}</th>
            </tr>
          </thead>
          <tbody>
            {record.actions.map((action) => (
              <tr className="border-t border-border" key={action.id}>
                <td className="py-3 pr-3 text-text-primary">
                  {labels.actionKind[action.kind]} ·{" "}
                  {labels.actionMode[action.mode]}
                  {isGroupAdmin &&
                  (action.rawRequest !== null ||
                    action.rawResponse !== null) ? (
                    <PayloadDialog
                      actionId={action.id}
                      closeLabel={labels.closePayload}
                      label={labels.rawPayload}
                      noResponseLabel={labels.noPayloadResponse}
                      rawRequest={action.rawRequest}
                      rawRequestLabel={labels.rawRequest}
                      rawResponse={action.rawResponse}
                      rawResponseLabel={labels.rawResponse}
                    />
                  ) : null}
                </td>
                <td className="py-3 pr-3 text-text-secondary">
                  {labels.actionStatus[action.status]}
                </td>
                <td className="py-3 pr-3 font-mono text-xs text-text-secondary">
                  {action.vendorRef ?? labels.noDate}
                </td>
                <td className="py-3 pr-3 text-text-secondary">
                  {formatDateTime(action.sentAt, locale, labels.noDate)}
                </td>
                <td className="py-3 pr-3 text-text-secondary">
                  {formatDateTime(action.resolvedAt, locale, labels.noDate)}
                </td>
                <td className="py-3 text-error-text">
                  {action.failureReason ?? labels.noDate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AssignmentPanel({
  labels,
  locale,
  record,
}: {
  readonly labels: RequestRecordLabels;
  readonly locale: "es-EC" | "en-US";
  readonly record: RequestRecordProjection;
}) {
  return (
    <section
      aria-labelledby="tab_asignacion"
      className="p-4"
      data-testid="asignacion_panel"
      id="panel_assignment"
    >
      {record.assignment ? (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div><dt className="text-sm text-text-muted">{labels.startedOn}</dt><dd className="font-semibold text-text-primary">{formatDate(record.assignment.startedOn, locale, labels.noDate)}</dd></div>
            <div><dt className="text-sm text-text-muted">{labels.endedOn}</dt><dd className="font-semibold text-text-primary">{formatDate(record.assignment.endedOn, locale, labels.noDate)}</dd></div>
            <div><dt className="text-sm text-text-muted">{labels.state}</dt><dd className="font-semibold text-text-primary">{record.assignment.endedOn ? labels.assignmentEnded : labels.assignmentActive}</dd></div>
          </dl>
          <Link
            className="mt-4 inline-flex min-h-11 items-center rounded border border-border px-4 font-semibold text-text-primary"
            data-testid="btn_ver_registro"
            href="/registro"
          >
            {labels.viewRegister}
          </Link>
        </>
      ) : (
        <p className="py-8 text-center text-text-secondary">
          {labels.assignmentEmpty}
        </p>
      )}
    </section>
  );
}

function AuditPanel({
  labels,
  locale,
  record,
}: {
  readonly labels: RequestRecordLabels;
  readonly locale: "es-EC" | "en-US";
  readonly record: RequestRecordProjection;
}) {
  return (
    <section
      aria-labelledby="tab_auditoria"
      className="overflow-x-auto p-4"
      data-testid="auditoria_table"
      id="panel_audit"
    >
      {record.audit.length === 0 ? (
        <p className="py-8 text-center text-text-secondary">
          {labels.auditEmpty}
        </p>
      ) : (
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-text-secondary">
            <tr>
              <th className="pb-3 font-semibold" scope="col">{labels.sentAt}</th>
              <th className="pb-3 font-semibold" scope="col">{labels.requestedBy}</th>
              <th className="pb-3 font-semibold" scope="col">{labels.kind}</th>
              <th className="pb-3 font-semibold" scope="col">{labels.organization}</th>
            </tr>
          </thead>
          <tbody>
            {record.audit.map((event) => (
              <tr className="border-t border-border" key={event.id}>
                <td className="py-3 pr-3 text-text-secondary">{formatDateTime(event.occurredAt, locale, labels.noDate)}</td>
                <td className="py-3 pr-3 text-text-primary">{event.actor ?? labels.systemActor}</td>
                <td className="py-3 pr-3 font-mono text-xs text-text-primary">{event.action}</td>
                <td className="py-3 text-text-secondary">{event.entityType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
