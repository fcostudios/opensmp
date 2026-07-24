import type { Metadata } from "next";
import "./globals.css";
import { AuthSessionProvider } from "@/lib/auth/session-provider";

export const metadata: Metadata = {
  title: "Ledger",
  description: "Ledger",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // IMP-255 / I02 — the auth provider IS mounted (was a `// TODO` no-op, so
  // `useUser()` in header.tsx threw at runtime on every authenticated page).
  // AuthSessionProvider is the stack-correct client wrapper (Auth0Provider for
  // an Auth0 stack, SessionProvider for next-auth) — it fetches the session
  // client-side, so this server component stays SSR/prerender-safe.
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
