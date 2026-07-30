"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { DataTable } from "@smp/ui";

import type { PersonAction } from "@/modules/org-registry/actions/people";
import type { PersonListItem } from "@/modules/org-registry/repository";
import { PersonForm, type PersonFormLabels } from "./person-form";

export interface PeopleTableLabels extends PersonFormLabels {
  readonly allCompanies: string;
  readonly allLicenses: string;
  readonly allStatuses: string;
  readonly currentLicense: string;
  readonly emailColumn: string;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly filters: string;
  readonly groupPeople: string;
  readonly lastActivity: string;
  readonly license: string;
  readonly nameColumn: string;
  readonly newPerson: string;
  readonly noLicense: string;
  readonly freshness: string;
  readonly subtitle: string;
  readonly title: string;
  readonly withLicense: string;
  readonly withoutLicense: string;
}

export function PeopleTable({
  companies,
  createAction,
  labels,
  locale,
  people,
}: {
  readonly companies: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly createAction: PersonAction;
  readonly labels: PeopleTableLabels;
  readonly locale: string;
  readonly people: readonly PersonListItem[];
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState("all");
  const [status, setStatus] = useState("all");
  const [license, setLicense] = useState("all");
  const rows = useMemo(
    () =>
      people.filter(
        (candidate) =>
          (companyId === "all" || candidate.companyId === companyId) &&
          (status === "all" || candidate.status === status) &&
          (license === "all" ||
            (license === "with" &&
              candidate.currentLicenseState === "active") ||
            (license === "without" &&
              candidate.currentLicenseState === "none")),
      ),
    [companyId, license, people, status],
  );
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }),
    [locale],
  );

  return (
    <div className="space-y-4">
      <section
        className="flex justify-end"
        data-testid="people_actions"
      >
        <details className="w-full rounded border border-border bg-surface p-4">
          <summary
            className="ml-auto w-fit cursor-pointer rounded bg-primary px-4 py-3 font-semibold text-text-on-primary focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="btn_new_person"
          >
            {labels.newPerson}
          </summary>
          <div className="mt-4 border-t border-border pt-4" data-testid="modal_new_person">
            <h2 className="font-display text-xl font-semibold text-text-primary">
              {labels.newTitle}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {labels.newDescription}
            </p>
            <div className="mt-4">
              <PersonForm
                action={createAction}
                companies={companies}
                labels={labels}
                mode="create"
              />
            </div>
          </div>
        </details>
      </section>

      <section
        aria-label={labels.filters}
        className="grid gap-3 rounded border border-border bg-surface p-4 sm:grid-cols-3"
        data-testid="people_filters"
      >
        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.company}</span>
          <select
            className="min-h-11 w-full rounded border border-border bg-surface px-3"
            data-testid="filter_company"
            onChange={(event) => setCompanyId(event.target.value)}
            value={companyId}
          >
            <option value="all">{labels.allCompanies}</option>
            {companies.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.status}</span>
          <select
            className="min-h-11 w-full rounded border border-border bg-surface px-3"
            data-testid="filter_status"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="all">{labels.allStatuses}</option>
            <option value="active">{labels.active}</option>
            <option value="departed">{labels.departed}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.license}</span>
          <select
            className="min-h-11 w-full rounded border border-border bg-surface px-3"
            data-testid="filter_license"
            onChange={(event) => setLicense(event.target.value)}
            value={license}
          >
            <option value="all">{labels.allLicenses}</option>
            <option value="with">{labels.withLicense}</option>
            <option value="without">{labels.withoutLicense}</option>
          </select>
        </label>
      </section>

      <section
        className="overflow-hidden rounded border border-border bg-surface"
        data-testid="people_table"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-display text-xl font-semibold text-text-primary">
            {labels.groupPeople}
          </h2>
        </div>
        <DataTable
          caption={labels.groupPeople}
          columns={[
            { id: "full_name", label: labels.nameColumn },
            { id: "email", label: labels.emailColumn },
            { id: "company", label: labels.company },
            { id: "status", label: labels.status },
            { id: "current_license", label: labels.currentLicense },
            { id: "last_active", label: labels.lastActivity },
          ]}
          emptyLabel={`${labels.emptyTitle}. ${labels.emptyDescription}`}
          onRowClick={(id) => router.push(`/personas/${id}`)}
          rows={rows.map((candidate) => ({
            id: candidate.id,
            cells: {
              full_name: (
                <span className="font-semibold text-text-primary">
                  {candidate.fullName}
                </span>
              ),
              email: candidate.email,
              company: candidate.companyName,
              status: (
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                    candidate.status === "active"
                      ? "bg-success-bg text-success"
                      : "bg-neutral-bg text-neutral-text"
                  }`}
                >
                  {candidate.status === "active"
                    ? labels.active
                    : labels.departed}
                </span>
              ),
              current_license: candidate.currentLicense ?? labels.noLicense,
              last_active: candidate.lastActiveOn
                ? dateFormat.format(
                    new Date(`${candidate.lastActiveOn}T00:00:00.000Z`),
                  )
                : labels.noLicense,
            },
          }))}
        />
      </section>
    </div>
  );
}
