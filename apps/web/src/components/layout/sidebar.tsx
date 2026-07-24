    "use client";

    import Link from "next/link";
    import { usePathname } from "next/navigation";

    const navItems = [
        { label: "Panel general", icon: "LayoutDashboard", href: "/panel" },
{ label: "Mis solicitudes", icon: "FileText", href: "/solicitudes" },
{ label: "Aprobaciones", icon: "Inbox", href: "/aprobaciones" },
{ label: "Reclamaciones", icon: "RotateCcw", href: "/reclamaciones" },
{ label: "Excepciones", icon: "AlertTriangle", href: "/excepciones" },
{ label: "Cupos", icon: "Gauge", href: "/cupos" },
{ label: "Actividad y uso", icon: "Activity", href: "/uso" },
{ label: "Registro", icon: "BookOpen", href: "/registro" },
{ label: "Estados de cuenta", icon: "Receipt", href: "/estados-de-cuenta" },
{ label: "Cierre mensual", icon: "Calculator", href: "/cierre" },
{ label: "Conciliación", icon: "Scale", href: "/conciliacion" },
{ label: "Tarifas", icon: "CircleDollarSign", href: "/tarifas" },
{ label: "Compañías", icon: "Building2", href: "/companias" },
{ label: "Personas", icon: "Users", href: "/personas" },
{ label: "Organizaciones", icon: "Network", href: "/organizaciones" },
{ label: "Credenciales", icon: "KeyRound", href: "/credenciales" },
{ label: "Usuarios y roles", icon: "ShieldCheck", href: "/usuarios" },
{ label: "Alertas", icon: "Bell", href: "/alertas" },
{ label: "Auditoría", icon: "ScrollText", href: "/auditoria" },
{ label: "Configuración", icon: "Settings", href: "/configuracion" }
    ];

    export function Sidebar() {
      const pathname = usePathname();
      return (
        <aside className="hidden md:flex w-60 flex-col border-r bg-white">
          <div className="flex h-14 items-center px-4 font-bold text-lg">
            Ledger
          </div>
          <nav className="flex-1 space-y-1 px-2 py-4">
            {navItems.map((item) => {
              const active = pathname.startsWith(item.href);
              // Active-nav color is data-driven from the project's primary
              // token (apps/web/src/styles/tokens.css), NOT a hardcoded hue —
              // the design system owns the brand color (IMP-241).
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                    active ? "font-medium" : "text-gray-700 hover:bg-gray-100"
                  }`}
                  style={
                    active
                      ? { color: "var(--color-primary)", backgroundColor: "var(--color-primary-soft)" }
                      : undefined
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
      );
    }
