import { getLocale, getMessages } from "next-intl/server";
import { redirect } from "next/navigation";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { renderUsersRolesPage } from "@/modules/identity-access/users-roles-page";

export default async function UsersRolesPage() {
  const {
    createProductionUserAdminService,
    loadCurrentLedgerAuthorization,
  } = await import("@/modules/identity-access/server-authorization");
  const authorization = await loadCurrentLedgerAuthorization();
  const service = createProductionUserAdminService();
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return renderUsersRolesPage({
    authorization,
    locale,
    messages,
    redirectToAccessDenied: () => redirect(ROUTE_SCR_ACCESS_DENIED),
    service,
  });
}
