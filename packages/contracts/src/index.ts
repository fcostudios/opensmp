// contracts — drizzle-zod schemas derived from the db package (PRIN-03).
// One direction: packages/db/schema.ts is the SSOT; these zod schemas
// derive from it, so validation can't drift from the tables.
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  alertRule,
  alertEvent,
  systemSetting,
  auditLog,
  rateCard,
  statement,
  statementLine,
  closeRun,
  reconciliation,
  reconciliationVarianceLine,
  company,
  person,
  userAccount,
  companyRoleAssignment,
  licenseAssignment,
  provisioningAction,
  reclamationProposal,
  licenseRequest,
  requestTransition,
  activityRecord,
  costRecord,
  vendor,
  vendorAccount,
  vendorAccountCapacity,
  licenseType,
  integrationCredential
} from "@smp/db/schema";

export { SYSTEM_USER_EMAIL, SYSTEM_USER_ID } from "@smp/db/system-ids";

export const insertAlertRuleSchema = createInsertSchema(alertRule);
export const selectAlertRuleSchema = createSelectSchema(alertRule);
export const insertAlertEventSchema = createInsertSchema(alertEvent);
export const selectAlertEventSchema = createSelectSchema(alertEvent);
export const insertSystemSettingSchema = createInsertSchema(systemSetting);
export const selectSystemSettingSchema = createSelectSchema(systemSetting);
export const insertAuditLogSchema = createInsertSchema(auditLog);
export const selectAuditLogSchema = createSelectSchema(auditLog);
export const insertRateCardSchema = createInsertSchema(rateCard);
export const selectRateCardSchema = createSelectSchema(rateCard);
export const insertStatementSchema = createInsertSchema(statement);
export const selectStatementSchema = createSelectSchema(statement);
export const insertStatementLineSchema = createInsertSchema(statementLine);
export const selectStatementLineSchema = createSelectSchema(statementLine);
export const insertCloseRunSchema = createInsertSchema(closeRun);
export const selectCloseRunSchema = createSelectSchema(closeRun);
export const insertReconciliationSchema = createInsertSchema(reconciliation);
export const selectReconciliationSchema = createSelectSchema(reconciliation);
export const insertReconciliationVarianceLineSchema = createInsertSchema(reconciliationVarianceLine);
export const selectReconciliationVarianceLineSchema = createSelectSchema(reconciliationVarianceLine);
export const insertCompanySchema = createInsertSchema(company);
export const selectCompanySchema = createSelectSchema(company);
export const insertPersonSchema = createInsertSchema(person);
export const selectPersonSchema = createSelectSchema(person);
export const insertUserAccountSchema = createInsertSchema(userAccount);
export const selectUserAccountSchema = createSelectSchema(userAccount);
export const insertCompanyRoleAssignmentSchema = createInsertSchema(companyRoleAssignment);
export const selectCompanyRoleAssignmentSchema = createSelectSchema(companyRoleAssignment);
export const insertLicenseAssignmentSchema = createInsertSchema(licenseAssignment);
export const selectLicenseAssignmentSchema = createSelectSchema(licenseAssignment);
export const insertProvisioningActionSchema = createInsertSchema(provisioningAction);
export const selectProvisioningActionSchema = createSelectSchema(provisioningAction);
export const insertReclamationProposalSchema = createInsertSchema(reclamationProposal);
export const selectReclamationProposalSchema = createSelectSchema(reclamationProposal);
export const insertLicenseRequestSchema = createInsertSchema(licenseRequest);
export const selectLicenseRequestSchema = createSelectSchema(licenseRequest);
export const insertRequestTransitionSchema = createInsertSchema(requestTransition);
export const selectRequestTransitionSchema = createSelectSchema(requestTransition);
export const insertActivityRecordSchema = createInsertSchema(activityRecord);
export const selectActivityRecordSchema = createSelectSchema(activityRecord);
export const insertCostRecordSchema = createInsertSchema(costRecord);
export const selectCostRecordSchema = createSelectSchema(costRecord);
export const insertVendorSchema = createInsertSchema(vendor);
export const selectVendorSchema = createSelectSchema(vendor);
export const insertVendorAccountSchema = createInsertSchema(vendorAccount);
export const selectVendorAccountSchema = createSelectSchema(vendorAccount);
export const insertVendorAccountCapacitySchema = createInsertSchema(vendorAccountCapacity);
export const selectVendorAccountCapacitySchema = createSelectSchema(vendorAccountCapacity);
export const insertLicenseTypeSchema = createInsertSchema(licenseType);
export const selectLicenseTypeSchema = createSelectSchema(licenseType);
export const insertIntegrationCredentialSchema = createInsertSchema(integrationCredential);
export const selectIntegrationCredentialSchema = createSelectSchema(integrationCredential);
