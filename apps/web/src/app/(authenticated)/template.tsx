import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ApplicationShell } from "@/components/layout/app-shell";
import { auth } from "@/lib/auth/auth-config";
import { authenticatedRouteRedirect } from "@/lib/auth/route-guard";
import { updateLocale } from "@/modules/identity-access/actions/update-locale";
import { dynamicBreadcrumbRepository } from "@/modules/navigation/repository";

export default async function AuthenticatedTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-ledger-pathname");
  const destination = authenticatedRouteRedirect(
    session?.user ?? null,
    pathname,
  );
  if (destination) redirect(destination);
  if (!session?.user || !pathname) redirect("/login");
  const user = session.user;
  const dynamicBreadcrumbLabels =
    await dynamicBreadcrumbRepository.resolve(pathname, user);
  if (!dynamicBreadcrumbLabels) redirect("/acceso-denegado");

  return (
    <ApplicationShell
      displayName={user.name || user.email}
      dynamicBreadcrumbLabels={dynamicBreadcrumbLabels}
      pathname={pathname}
      roles={user.roles}
      updateLocaleAction={updateLocale}
    >
      {children}
    </ApplicationShell>
  );
}
