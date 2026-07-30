import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/auth-config";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return children;
}
