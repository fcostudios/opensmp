import type { ReactNode } from "react";

export interface AppShellProps {
  readonly children: ReactNode;
  readonly desktopNavigation: ReactNode;
  readonly header: ReactNode;
  readonly mobileNavigation: ReactNode;
}

export function AppShell({
  children,
  desktopNavigation,
  header,
  mobileNavigation,
}: AppShellProps) {
  return (
    <div
      data-organism="app-shell"
      className="min-h-dvh bg-background text-text-primary"
    >
      <div
        data-shell-slot="desktop-navigation"
        className="fixed inset-y-0 left-0 z-30 hidden md:block"
      >
        {desktopNavigation}
      </div>
      <div
        data-shell-slot="mobile-navigation"
        className="sticky top-0 z-40 md:hidden"
      >
        {mobileNavigation}
      </div>
      <div className="min-w-0 md:pl-16 lg:pl-[248px]">
        <div data-shell-slot="header">{header}</div>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-h-[calc(100dvh-5rem)] max-w-[1280px] p-3 outline-none sm:p-4 lg:p-5"
        >
          <div className="min-h-full rounded-lg bg-surface p-3 shadow-sm sm:p-4">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
