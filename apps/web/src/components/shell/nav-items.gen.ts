// AUTO-GENERATED — DO NOT EDIT.
// Source:      docs/specs/07c_navigation_map.json  (app_shell.sidebar.items[])
// Generator:   infra/scripts/regenerate-sidebar.py
// Nav map updated:  unknown
//
// Sidebar ordering, role gates, labels, and badges live in the nav map.
// To change anything here, update the nav map in Nous and re-run the generator.
// Regenerate with:  ./infra/scripts/regenerate-sidebar.py

import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Building2,
  Calculator,
  CircleDollarSign,
  FileText,
  Gauge,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Network,
  Receipt,
  RotateCcw,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

// UserRole — the distinct roles the nav map gates sidebar items on.
// Generated locally (the dev team may re-home this in a real auth hook).
export type UserRole = "approver" | "central_finance" | "company_finance" | "employee" | "group_admin";
export type NavSectionId = "operation" | "finance" | "administration";

export const navSections = [
  { id: "operation" },
  { id: "finance" },
  { id: "administration" },
] as const satisfies readonly { id: NavSectionId }[];

export interface NavItem {
  id: string;
  label: string;
  labelKey: string;
  icon: LucideIcon;
  href: string;
  screenId: string;
  section: NavSectionId;
  roles?: UserRole[];
  /** Key on the API unread-count response — renders a numeric badge when > 0. */
  badge?: string;
  /** Sidebar placement bucket — "bottom" pins to the foot (e.g. Profile,
   *  Admin); "top"/"middle" order within the main list. */
  position?: "top" | "middle" | "bottom";
}

export const navItems: readonly NavItem[] = [
  {
    id: "nav-panel",
    label: "Panel general",
    labelKey: "nav.panel",
    icon: LayoutDashboard,
    href: "/panel",
    screenId: "SCR-admin-dashboard",
    section: "operation",
    roles: ["group_admin"],
  },
  {
    id: "nav-solicitudes",
    label: "Mis solicitudes",
    labelKey: "nav.solicitudes",
    icon: FileText,
    href: "/solicitudes",
    screenId: "SCR-my-requests",
    section: "operation",
    roles: ["employee", "approver", "group_admin"],
  },
  {
    id: "nav-aprobaciones",
    label: "Aprobaciones",
    labelKey: "nav.aprobaciones",
    icon: Inbox,
    href: "/aprobaciones",
    screenId: "SCR-approval-queue",
    section: "operation",
    roles: ["approver", "group_admin"],
  },
  {
    id: "nav-reclamaciones",
    label: "Reclamaciones",
    labelKey: "nav.reclamaciones",
    icon: RotateCcw,
    href: "/reclamaciones",
    screenId: "SCR-reclamation-proposals",
    section: "operation",
    roles: ["approver", "group_admin"],
  },
  {
    id: "nav-excepciones",
    label: "Excepciones",
    labelKey: "nav.excepciones",
    icon: AlertTriangle,
    href: "/excepciones",
    screenId: "SCR-exceptions",
    section: "operation",
    roles: ["group_admin"],
  },
  {
    id: "nav-cupos",
    label: "Cupos",
    labelKey: "nav.cupos",
    icon: Gauge,
    href: "/cupos",
    screenId: "SCR-pools",
    section: "operation",
    roles: ["group_admin"],
  },
  {
    id: "nav-uso",
    label: "Actividad y uso",
    labelKey: "nav.uso",
    icon: Activity,
    href: "/uso",
    screenId: "SCR-usage",
    section: "operation",
    roles: ["group_admin"],
  },
  {
    id: "nav-registro",
    label: "Registro",
    labelKey: "nav.registro",
    icon: BookOpen,
    href: "/registro",
    screenId: "SCR-register",
    section: "operation",
    roles: ["group_admin", "central_finance"],
  },
  {
    id: "nav-estados-de-cuenta",
    label: "Estados de cuenta",
    labelKey: "nav.estados_de_cuenta",
    icon: Receipt,
    href: "/estados-de-cuenta",
    screenId: "SCR-statements",
    section: "finance",
    roles: ["company_finance", "central_finance", "group_admin"],
  },
  {
    id: "nav-cierre",
    label: "Cierre mensual",
    labelKey: "nav.cierre",
    icon: Calculator,
    href: "/cierre",
    screenId: "SCR-close",
    section: "finance",
    roles: ["central_finance", "group_admin"],
  },
  {
    id: "nav-conciliacion",
    label: "Conciliación",
    labelKey: "nav.conciliacion",
    icon: Scale,
    href: "/conciliacion",
    screenId: "SCR-reconciliation",
    section: "finance",
    roles: ["central_finance", "group_admin"],
  },
  {
    id: "nav-tarifas",
    label: "Tarifas",
    labelKey: "nav.tarifas",
    icon: CircleDollarSign,
    href: "/tarifas",
    screenId: "SCR-rates",
    section: "finance",
    roles: ["central_finance", "group_admin"],
  },
  {
    id: "nav-companias",
    label: "Compañías",
    labelKey: "nav.companias",
    icon: Building2,
    href: "/companias",
    screenId: "SCR-companies",
    section: "administration",
    roles: ["group_admin"],
  },
  {
    id: "nav-personas",
    label: "Personas",
    labelKey: "nav.personas",
    icon: Users,
    href: "/personas",
    screenId: "SCR-people",
    section: "administration",
    roles: ["group_admin"],
  },
  {
    id: "nav-organizaciones",
    label: "Organizaciones",
    labelKey: "nav.organizaciones",
    icon: Network,
    href: "/organizaciones",
    screenId: "SCR-vendor-accounts",
    section: "administration",
    roles: ["group_admin"],
  },
  {
    id: "nav-credenciales",
    label: "Credenciales",
    labelKey: "nav.credenciales",
    icon: KeyRound,
    href: "/credenciales",
    screenId: "SCR-credentials",
    section: "administration",
    roles: ["group_admin"],
  },
  {
    id: "nav-usuarios",
    label: "Usuarios y roles",
    labelKey: "nav.usuarios",
    icon: ShieldCheck,
    href: "/usuarios",
    screenId: "SCR-users-roles",
    section: "administration",
    roles: ["group_admin"],
  },
  {
    id: "nav-alertas",
    label: "Alertas",
    labelKey: "nav.alertas",
    icon: Bell,
    href: "/alertas",
    screenId: "SCR-alerts",
    section: "administration",
    roles: ["group_admin"],
  },
  {
    id: "nav-auditoria",
    label: "Auditoría",
    labelKey: "nav.auditoria",
    icon: ScrollText,
    href: "/auditoria",
    screenId: "SCR-audit",
    section: "administration",
    roles: ["group_admin"],
  },
  {
    id: "nav-configuracion",
    label: "Configuración",
    labelKey: "nav.configuracion",
    icon: Settings,
    href: "/configuracion",
    screenId: "SCR-settings",
    section: "administration",
    roles: ["group_admin"],
  },
] as const;
