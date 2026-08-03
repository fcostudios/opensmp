import { getLocale, getMessages } from "next-intl/server";
import { redirect } from "next/navigation";
import {
  UsersRolesPanel,
  type UsersRolesLabels,
} from "@/components/users/users-roles-panel";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import {
  addCompanyRole,
  createUserAccount,
  disableUserAccount,
  removeCompanyRole,
  resetTwoFactor,
} from "@/modules/identity-access/actions/manage-users";
import {
  createProductionUserAdminService,
  loadCurrentLedgerAuthorization,
} from "@/modules/identity-access/server-authorization";

export default async function UsersRolesPage() {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || authorization.globalRole !== "group_admin") {
    redirect(ROUTE_SCR_ACCESS_DENIED);
  }
  const service = createProductionUserAdminService();
  const [users, grants, companies, people, locale, messages] = await Promise.all([
    service.listUsers(authorization.idpSubject),
    service.listCompanyRoles(authorization.idpSubject),
    service.listCompanies(authorization.idpSubject),
    service.listAvailablePeople(authorization.idpSubject),
    getLocale(),
    getMessages(),
  ]);
  const labels = messages.usersRoles as unknown as UsersRolesLabels;

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {labels.title}
        </h1>
        <p className="mt-1 text-text-secondary">{labels.subtitle}</p>
      </header>
      <UsersRolesPanel
        actions={{
          createUser: createUserAccount,
          disableUser: disableUserAccount,
          grantRole: addCompanyRole,
          removeRole: removeCompanyRole,
          resetTwoFactor,
        }}
        companies={companies}
        grants={grants}
        labels={labels}
        locale={locale}
        people={people}
        users={users}
      />
    </main>
  );
}
