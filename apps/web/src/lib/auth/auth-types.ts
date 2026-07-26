export type LedgerGlobalRole = "group_admin" | "central_finance";
export type LedgerCompanyRole = "approver" | "finance" | "viewer";
export type LedgerRole =
  | "employee"
  | "approver"
  | "company_finance"
  | "central_finance"
  | "group_admin"
  | "viewer";
export type LedgerUiLanguage = "es" | "en";

export interface LedgerCompanyGrant {
  readonly companyId: string;
  readonly role: LedgerCompanyRole;
}

export interface LedgerSessionUser {
  readonly id: string;
  readonly idpSubject: string;
  readonly email: string;
  readonly name: string;
  readonly globalRole: LedgerGlobalRole | null;
  readonly companyGrants: readonly LedgerCompanyGrant[];
  readonly employeeCompanyId: string | null;
  readonly roles: readonly LedgerRole[];
  readonly companyIds: readonly string[];
  readonly uiLanguage: LedgerUiLanguage | null;
}
