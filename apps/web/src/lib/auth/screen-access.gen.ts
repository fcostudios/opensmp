// AUTO-GENERATED — DO NOT EDIT.
// Source: docs/specs/07c_navigation_map.json role_based_views
// Generator: infra/scripts/regenerate-sidebar.py

export type ScreenRole = "public" | "employee" | "approver" | "company_finance" | "central_finance" | "group_admin" | "viewer";

export const ROLE_SCREEN_IDS = {
  "public": ["SCR-login", "SCR-access-denied"],
  "employee": ["SCR-login", "SCR-my-requests", "SCR-new-request", "SCR-request-detail", "SCR-access-denied"],
  "approver": ["SCR-login", "SCR-my-requests", "SCR-new-request", "SCR-request-detail", "SCR-approval-queue", "SCR-reclamation-proposals", "SCR-company-detail", "SCR-access-denied"],
  "company_finance": ["SCR-login", "SCR-statements", "SCR-statement-detail", "SCR-company-detail", "SCR-access-denied"],
  "central_finance": ["SCR-login", "SCR-register", "SCR-statements", "SCR-statement-detail", "SCR-close", "SCR-reconciliation", "SCR-rates", "SCR-access-denied"],
  "group_admin": ["SCR-login", "SCR-my-requests", "SCR-new-request", "SCR-request-detail", "SCR-approval-queue", "SCR-reclamation-proposals", "SCR-admin-dashboard", "SCR-exceptions", "SCR-pools", "SCR-vendor-accounts", "SCR-vendor-account-detail", "SCR-credentials", "SCR-companies", "SCR-company-detail", "SCR-people", "SCR-person-detail", "SCR-register", "SCR-usage", "SCR-alerts", "SCR-audit", "SCR-users-roles", "SCR-statements", "SCR-statement-detail", "SCR-close", "SCR-reconciliation", "SCR-rates", "SCR-settings", "SCR-access-denied"],
  "viewer": ["SCR-login", "SCR-company-detail", "SCR-access-denied"],
} as const satisfies Record<ScreenRole, readonly string[]>;

export const SCREEN_ROLES = {
  "SCR-login": ["public", "employee", "approver", "company_finance", "central_finance", "group_admin", "viewer"],
  "SCR-access-denied": ["public", "employee", "approver", "company_finance", "central_finance", "group_admin", "viewer"],
  "SCR-my-requests": ["employee", "approver", "group_admin"],
  "SCR-new-request": ["employee", "approver", "group_admin"],
  "SCR-request-detail": ["employee", "approver", "group_admin"],
  "SCR-approval-queue": ["approver", "group_admin"],
  "SCR-reclamation-proposals": ["approver", "group_admin"],
  "SCR-company-detail": ["approver", "company_finance", "group_admin", "viewer"],
  "SCR-statements": ["company_finance", "central_finance", "group_admin"],
  "SCR-statement-detail": ["company_finance", "central_finance", "group_admin"],
  "SCR-register": ["central_finance", "group_admin"],
  "SCR-close": ["central_finance", "group_admin"],
  "SCR-reconciliation": ["central_finance", "group_admin"],
  "SCR-rates": ["central_finance", "group_admin"],
  "SCR-admin-dashboard": ["group_admin"],
  "SCR-exceptions": ["group_admin"],
  "SCR-pools": ["group_admin"],
  "SCR-vendor-accounts": ["group_admin"],
  "SCR-vendor-account-detail": ["group_admin"],
  "SCR-credentials": ["group_admin"],
  "SCR-companies": ["group_admin"],
  "SCR-people": ["group_admin"],
  "SCR-person-detail": ["group_admin"],
  "SCR-usage": ["group_admin"],
  "SCR-alerts": ["group_admin"],
  "SCR-audit": ["group_admin"],
  "SCR-users-roles": ["group_admin"],
  "SCR-settings": ["group_admin"],
} as const satisfies Record<string, readonly ScreenRole[]>;

export const DEFAULT_ROUTE_BY_ROLE = {
  "public": "/login",
  "employee": "/solicitudes",
  "approver": "/aprobaciones",
  "company_finance": "/estados-de-cuenta",
  "central_finance": "/cierre",
  "group_admin": "/panel",
  "viewer": "/companias/:companyId",
} as const satisfies Record<ScreenRole, string>;

export const ROUTE_SCREEN_IDS = {
  "/login": "SCR-login",
  "/solicitudes": "SCR-my-requests",
  "/solicitudes/nueva": "SCR-new-request",
  "/solicitudes/:requestId": "SCR-request-detail",
  "/aprobaciones": "SCR-approval-queue",
  "/reclamaciones": "SCR-reclamation-proposals",
  "/panel": "SCR-admin-dashboard",
  "/excepciones": "SCR-exceptions",
  "/cupos": "SCR-pools",
  "/organizaciones": "SCR-vendor-accounts",
  "/organizaciones/:vendorAccountId": "SCR-vendor-account-detail",
  "/credenciales": "SCR-credentials",
  "/companias": "SCR-companies",
  "/companias/:companyId": "SCR-company-detail",
  "/personas": "SCR-people",
  "/personas/:personId": "SCR-person-detail",
  "/registro": "SCR-register",
  "/uso": "SCR-usage",
  "/alertas": "SCR-alerts",
  "/auditoria": "SCR-audit",
  "/usuarios": "SCR-users-roles",
  "/estados-de-cuenta": "SCR-statements",
  "/estados-de-cuenta/:statementId": "SCR-statement-detail",
  "/cierre": "SCR-close",
  "/conciliacion": "SCR-reconciliation",
  "/tarifas": "SCR-rates",
  "/configuracion": "SCR-settings",
  "/acceso-denegado": "SCR-access-denied",
} as const;

export const PUBLIC_SCREEN_IDS = ["SCR-login", "SCR-access-denied"] as const;
