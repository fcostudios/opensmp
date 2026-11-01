import { FreshnessLabel, type UiLocale } from "@smp/ui";

export interface AssignmentLabelCatalog {
  readonly sourceKindManual: string;
  readonly sourceKindRequest: string;
  readonly sourceKindImport: string;
  readonly sourceKindReconciliation: string;
  readonly endReasonLeftCompany: string;
  readonly endReasonInactive: string;
  readonly endReasonReallocated: string;
}

export function assignmentSourceLabel(
  value: "request" | "import" | "reconciliation" | "manual",
  labels: AssignmentLabelCatalog,
): string {
  const labelKey: Record<
    typeof value,
    keyof Pick<
      AssignmentLabelCatalog,
      | "sourceKindManual"
      | "sourceKindRequest"
      | "sourceKindImport"
      | "sourceKindReconciliation"
    >
  > = {
    manual: "sourceKindManual",
    request: "sourceKindRequest",
    import: "sourceKindImport",
    reconciliation: "sourceKindReconciliation",
  };
  return labels[labelKey[value]];
}

export function assignmentEndReasonLabel(
  value: "left_company" | "inactive" | "reallocated" | null,
  labels: AssignmentLabelCatalog,
): string | null {
  if (value === null) return null;
  const labelKey: Record<
    typeof value,
    keyof Pick<
      AssignmentLabelCatalog,
      | "endReasonLeftCompany"
      | "endReasonInactive"
      | "endReasonReallocated"
    >
  > = {
    left_company: "endReasonLeftCompany",
    inactive: "endReasonInactive",
    reallocated: "endReasonReallocated",
  };
  return labels[labelKey[value]];
}

export function PersonFreshness({
  locale,
  now,
  staleLabel,
  syncedAt,
  syncedLabel,
  unavailableLabel,
}: {
  readonly locale: UiLocale;
  readonly now: Date;
  readonly staleLabel: string;
  readonly syncedAt: Date | null;
  readonly syncedLabel: string;
  readonly unavailableLabel: string;
}) {
  if (!syncedAt) {
    return (
      <span
        data-testid="person_freshness_unavailable"
        role="status"
      >
        {unavailableLabel}
      </span>
    );
  }
  return (
    <FreshnessLabel
      locale={locale}
      now={now}
      prefix={syncedLabel}
      staleLabel={staleLabel}
      syncedAt={syncedAt}
    />
  );
}
