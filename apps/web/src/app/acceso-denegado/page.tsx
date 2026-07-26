import Link from "next/link";

import { auth } from "@/lib/auth/auth-config";
import messages from "@/lib/i18n/en-US.json";
import { roleLanding } from "@/lib/auth/role-landing";
import { ROUTE_SCR_LOGIN } from "@/lib/routes";

export default async function AccessDeniedPage() {
  const session = await auth();
  const destination = session ? roleLanding(session.user) : ROUTE_SCR_LOGIN;

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-surface-canvas p-6"
      data-testid="banner_access_denied"
    >
      <section className="w-full max-w-md rounded-lg bg-surface-panel p-8">
        <h1 className="text-2xl font-bold">{messages.auth.accessDeniedTitle}</h1>
        <p className="mt-2 text-text-secondary">
          {messages.auth.accessDeniedDescription}
        </p>
        <div className="mt-6" data-testid="actions_access_denied">
          <Link
            href={destination}
            data-testid={session ? "btn_go_home" : "btn_go_login"}
            className="rounded-md bg-action-primary px-4 py-2 font-semibold text-action-primary-foreground"
          >
            {session ? messages.auth.goHome : messages.auth.goLogin}
          </Link>
        </div>
      </section>
    </main>
  );
}
