import {
  UsersRolesPanel,
  type UsersRolesLabels,
} from "@/components/users/users-roles-panel";
import {
  addCompanyRole,
  createUserAccount,
  disableUserAccount,
  removeCompanyRole,
  resetTwoFactor,
} from "./actions/manage-users";
import type { createUserAdminService } from "./user-admin-service";

type UserAdminService = ReturnType<typeof createUserAdminService>;

export async function renderUsersRolesPage(input: {
  readonly authorization: { readonly globalRole: string | null; readonly idpSubject: string } | null;
  readonly locale: string;
  readonly messages: Record<string, unknown>;
  readonly redirectToAccessDenied: () => never;
  readonly service: UserAdminService;
}) {
  const { authorization } = input;
  if (!authorization || authorization.globalRole !== "group_admin") {
    input.redirectToAccessDenied();
  }
  const [users, grants, companies, people] = await Promise.all([
    input.service.listUsers(authorization.idpSubject),
    input.service.listCompanyRoles(authorization.idpSubject),
    input.service.listCompanies(authorization.idpSubject),
    input.service.listAvailablePeople(authorization.idpSubject),
  ]);
  const labels = input.messages.usersRoles as UsersRolesLabels;

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
        locale={input.locale}
        people={people}
        users={users}
      />
    </main>
  );
}
