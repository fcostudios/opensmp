import { getLocale, getMessages } from "next-intl/server";
import { redirect } from "next/navigation";

import { hasCapability } from "@smp/domain/identity-access";

import {
  PeopleTable,
  type PeopleTableLabels,
} from "@/components/people/people-table";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import {
  createPerson,
} from "@/modules/org-registry/actions/people";
import { peopleRepository } from "@/modules/org-registry/repository";

export default async function PeoplePage() {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || !hasCapability(authorization, "admin:manage")) {
    redirect("/acceso-denegado");
  }
  const [people, companies, locale, messages] = await Promise.all([
    peopleRepository.list(authorization),
    peopleRepository.companies(authorization),
    getLocale(),
    getMessages(),
  ]);
  const labels = messages.people as unknown as PeopleTableLabels;

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
          {labels.groupPeople}
        </p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {labels.title}
        </h1>
        <p className="mt-1 text-text-secondary">{labels.subtitle}</p>
        <p className="mt-2 text-xs text-text-muted">{labels.freshness}</p>
      </header>
      <PeopleTable
        companies={companies}
        createAction={createPerson}
        labels={labels}
        locale={locale}
        people={people}
      />
    </main>
  );
}
