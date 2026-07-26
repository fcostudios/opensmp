import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileBar } from "@/components/layout/mobile-bar";
import { auth } from "@/lib/auth/auth-config";
import { authenticatedRouteRedirect } from "@/lib/auth/route-guard";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const requestHeaders = await headers();
  const destination = authenticatedRouteRedirect(
    session?.user ?? null,
    requestHeaders.get("x-ledger-pathname"),
  );
  if (destination) redirect(destination);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <MobileBar />
    </div>
  );
}
