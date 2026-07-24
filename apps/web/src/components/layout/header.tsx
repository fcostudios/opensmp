"use client";

import { useSession } from "next-auth/react";

export function Header() {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "";

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-4">
      <div className="text-sm font-medium text-gray-600">
        {/* Page title injected by route */}
      </div>
      <div className="flex items-center gap-4">
        <button className="relative" aria-label="Notifications">
          <span className="sr-only">Notifications</span>
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
            3
          </span>
        </button>
        <span className="text-sm font-medium">{userName}</span>
        <div className="h-8 w-8 rounded-full bg-gray-300" aria-label="User avatar" />
      </div>
    </header>
  );
}
