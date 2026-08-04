import type { PoolCardsLabels } from "@/components/pools/pool-cards";

type PoolCardsTranslator = (key: keyof PoolCardsLabels) => string;

export function createPoolCardsLabels(
  t: PoolCardsTranslator,
): PoolCardsLabels {
  return {
    addCapacity: t("addCapacity"),
    assigned: t("assigned"),
    attention: t("attention"),
    automated: t("automated"),
    available: t("available"),
    candidateTitle: t("candidateTitle"),
    discrepancy: t("discrepancy"),
    effectiveFrom: t("effectiveFrom"),
    effectiveFromField: t("effectiveFromField"),
    emptyDescription: t("emptyDescription"),
    emptyTitle: t("emptyTitle"),
    escalated: t("escalated"),
    floor: t("floor"),
    lastActive: t("lastActive"),
    mode: t("mode"),
    monthlyCost: t("monthlyCost"),
    note: t("note"),
    noUsageData: t("noUsageData"),
    orchestration: t("orchestration"),
    pending: t("pending"),
    prorationNote: t("prorationNote"),
    purchased: t("purchased"),
    purchasedQty: t("purchasedQty"),
    renewal: t("renewal"),
    saveCapacity: t("saveCapacity"),
  };
}
