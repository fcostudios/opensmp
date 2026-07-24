"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items: { href: string; label: string }[] = [

];

export function MobileBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 flex md:hidden h-14 border-t bg-white">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        // Data-driven active color from the project's primary token (IMP-241).
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center justify-center text-xs ${
              active ? "" : "text-gray-500"
            }`}
            style={active ? { color: "var(--color-primary)" } : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
