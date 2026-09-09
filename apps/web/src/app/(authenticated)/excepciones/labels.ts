import type {
  BlockedRequestItem,
  BlockedRequestsLabels,
} from "@/components/exceptions/blocked-requests-table";
import type { BlockedExceptionItem } from "@/modules/request-workflow/read-repository";

type BlockedRequestsTranslator = (
  key: `blocked.${keyof BlockedRequestsLabels}`,
) => string;

export function createBlockedRequestsLabels(
  t: BlockedRequestsTranslator,
): BlockedRequestsLabels {
  return {
    addCapacity: t("blocked.addCapacity"),
    company: t("blocked.company"),
    daysBlocked: t("blocked.daysBlocked"),
    effectiveFrom: t("blocked.effectiveFrom"),
    empty: t("blocked.empty"),
    escalated: t("blocked.escalated"),
    lastActive: t("blocked.lastActive"),
    monthlyCost: t("blocked.monthlyCost"),
    neededBy: t("blocked.neededBy"),
    noDate: t("blocked.noDate"),
    noUsageData: t("blocked.noUsageData"),
    organization: t("blocked.organization"),
    prorationNote: t("blocked.prorationNote"),
    purchasedQty: t("blocked.purchasedQty"),
    reclaimCandidates: t("blocked.reclaimCandidates"),
    request: t("blocked.request"),
    saveCapacity: t("blocked.saveCapacity"),
    status: t("blocked.status"),
    statusBlocked: t("blocked.statusBlocked"),
    viewPools: t("blocked.viewPools"),
  };
}

export function toBlockedRequestItem(
  request: BlockedExceptionItem,
): BlockedRequestItem {
  return {
    companyName: request.companyName,
    daysBlocked: request.daysBlocked,
    decisionEvidence: request.decisionEvidence,
    escalated: request.escalated,
    id: request.id,
    licenseTypeId: request.licenseTypeId,
    licenseTypeName: request.licenseTypeName,
    neededBy: request.neededBy,
    personName: request.personName,
    requestNo: request.requestNo,
    vendorAccountId: request.vendorAccountId,
    vendorAccountName: request.vendorAccountName,
  };
}
