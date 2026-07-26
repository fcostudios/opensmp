/**
 * Route constants — auto-generated from Nous navigation map.
 * Use these instead of hardcoding path strings.
 * Regenerate: nous_package.py sync -c agent_files
 */

export const ROUTE_HOME = "/";
export const ROUTE_LOGIN = "/login";
export const ROUTE_AUTH_LANDING = "/auth/landing";
export const ROUTE_AUTH_SIGNIN = "/auth/signin";
export const ROUTE_AUTH_LOGOUT = "/auth/logout";
export const ROUTE_SCR_ACCESS_DENIED = "/acceso-denegado";
export const ROUTE_SCR_ADMIN_DASHBOARD = "/panel";
export const ROUTE_SCR_ALERTS = "/alertas";
export const ROUTE_SCR_APPROVAL_QUEUE = "/aprobaciones";
export const ROUTE_SCR_AUDIT = "/auditoria";
export const ROUTE_SCR_CLOSE = "/cierre";
export const ROUTE_SCR_COMPANIES = "/companias";
export const ROUTE_SCR_COMPANY_DETAIL = "/companias/:companyId";
export const ROUTE_SCR_CREDENTIALS = "/credenciales";
export const ROUTE_SCR_EXCEPTIONS = "/excepciones";
export const ROUTE_SCR_LOGIN = "/login";
export const ROUTE_SCR_MY_REQUESTS = "/solicitudes";
export const ROUTE_SCR_NEW_REQUEST = "/solicitudes/nueva";
export const ROUTE_SCR_PEOPLE = "/personas";
export const ROUTE_SCR_PERSON_DETAIL = "/personas/:personId";
export const ROUTE_SCR_POOLS = "/cupos";
export const ROUTE_SCR_RATES = "/tarifas";
export const ROUTE_SCR_RECLAMATION_PROPOSALS = "/reclamaciones";
export const ROUTE_SCR_RECONCILIATION = "/conciliacion";
export const ROUTE_SCR_REGISTER = "/registro";
export const ROUTE_SCR_REQUEST_DETAIL = "/solicitudes/:requestId";
export const ROUTE_SCR_SETTINGS = "/configuracion";
export const ROUTE_SCR_STATEMENTS = "/estados-de-cuenta";
export const ROUTE_SCR_STATEMENT_DETAIL = "/estados-de-cuenta/:statementId";
export const ROUTE_SCR_USAGE = "/uso";
export const ROUTE_SCR_USERS_ROLES = "/usuarios";
export const ROUTE_SCR_VENDOR_ACCOUNTS = "/organizaciones";
export const ROUTE_SCR_VENDOR_ACCOUNT_DETAIL = "/organizaciones/:vendorAccountId";

/** All routes as an object for dynamic lookup */
export const ROUTES = {
  HOME: ROUTE_HOME,
  LOGIN: ROUTE_LOGIN,
  AUTH_LANDING: ROUTE_AUTH_LANDING,
  AUTH_SIGNIN: ROUTE_AUTH_SIGNIN,
  AUTH_LOGOUT: ROUTE_AUTH_LOGOUT,
  SCR_ACCESS_DENIED: ROUTE_SCR_ACCESS_DENIED,
  SCR_ADMIN_DASHBOARD: ROUTE_SCR_ADMIN_DASHBOARD,
  SCR_ALERTS: ROUTE_SCR_ALERTS,
  SCR_APPROVAL_QUEUE: ROUTE_SCR_APPROVAL_QUEUE,
  SCR_AUDIT: ROUTE_SCR_AUDIT,
  SCR_CLOSE: ROUTE_SCR_CLOSE,
  SCR_COMPANIES: ROUTE_SCR_COMPANIES,
  SCR_COMPANY_DETAIL: ROUTE_SCR_COMPANY_DETAIL,
  SCR_CREDENTIALS: ROUTE_SCR_CREDENTIALS,
  SCR_EXCEPTIONS: ROUTE_SCR_EXCEPTIONS,
  SCR_LOGIN: ROUTE_SCR_LOGIN,
  SCR_MY_REQUESTS: ROUTE_SCR_MY_REQUESTS,
  SCR_NEW_REQUEST: ROUTE_SCR_NEW_REQUEST,
  SCR_PEOPLE: ROUTE_SCR_PEOPLE,
  SCR_PERSON_DETAIL: ROUTE_SCR_PERSON_DETAIL,
  SCR_POOLS: ROUTE_SCR_POOLS,
  SCR_RATES: ROUTE_SCR_RATES,
  SCR_RECLAMATION_PROPOSALS: ROUTE_SCR_RECLAMATION_PROPOSALS,
  SCR_RECONCILIATION: ROUTE_SCR_RECONCILIATION,
  SCR_REGISTER: ROUTE_SCR_REGISTER,
  SCR_REQUEST_DETAIL: ROUTE_SCR_REQUEST_DETAIL,
  SCR_SETTINGS: ROUTE_SCR_SETTINGS,
  SCR_STATEMENTS: ROUTE_SCR_STATEMENTS,
  SCR_STATEMENT_DETAIL: ROUTE_SCR_STATEMENT_DETAIL,
  SCR_USAGE: ROUTE_SCR_USAGE,
  SCR_USERS_ROLES: ROUTE_SCR_USERS_ROLES,
  SCR_VENDOR_ACCOUNTS: ROUTE_SCR_VENDOR_ACCOUNTS,
  SCR_VENDOR_ACCOUNT_DETAIL: ROUTE_SCR_VENDOR_ACCOUNT_DETAIL,
} as const;
