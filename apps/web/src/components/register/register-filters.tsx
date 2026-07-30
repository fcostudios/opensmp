import type { RegisterFilters as RegisterFilterValues } from "@smp/contracts/register";

interface RegisterFilterLabels {
  readonly all: string;
  readonly apply: string;
  readonly closed: string;
  readonly company: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly endReason: string;
  readonly endReasonInactive: string;
  readonly endReasonLeftCompany: string;
  readonly endReasonReallocated: string;
  readonly licenseType: string;
  readonly open: string;
  readonly openState: string;
  readonly organization: string;
  readonly person: string;
  readonly source: string;
  readonly sourceImport: string;
  readonly sourceKind: string;
  readonly sourceReconciliation: string;
  readonly sourceRequestNo: string;
}

interface FilterOption {
  readonly id: string;
  readonly label: string;
}

export interface RegisterFiltersProps {
  readonly companies: readonly FilterOption[];
  readonly endReasons: readonly ("left_company" | "inactive" | "reallocated")[];
  readonly filters: RegisterFilterValues;
  readonly labels: RegisterFilterLabels;
  readonly licenseTypes: readonly FilterOption[];
  readonly people: readonly FilterOption[];
  readonly sourceRequestNos: readonly string[];
  readonly vendorAccounts: readonly FilterOption[];
}

export function RegisterFilters({
  companies,
  endReasons,
  filters,
  labels,
  licenseTypes,
  people,
  sourceRequestNos,
  vendorAccounts,
}: RegisterFiltersProps) {
  return (
    <form
      className="grid gap-4 rounded border border-border bg-surface p-4 md:grid-cols-3"
      data-testid="register_filters"
      method="get"
    >
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.person}
        <select defaultValue={filters.personId ?? ""} name="personId"><option value="">{labels.all}</option>{people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}</select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.sourceKind}
        <select defaultValue={filters.sourceKind ?? ""} name="sourceKind"><option value="">{labels.all}</option><option value="request">{labels.source}</option><option value="import">{labels.sourceImport}</option><option value="reconciliation">{labels.sourceReconciliation}</option></select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.sourceRequestNo}
        <select defaultValue={filters.sourceRequestNo ?? ""} name="sourceRequestNo"><option value="">{labels.all}</option>{sourceRequestNos.map((requestNo) => <option key={requestNo} value={requestNo}>{requestNo}</option>)}</select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.endReason}
        <select defaultValue={filters.endReason ?? ""} name="endReason"><option value="">{labels.all}</option>{endReasons.map((reason) => <option key={reason} value={reason}>{reason === "inactive" ? labels.endReasonInactive : reason === "left_company" ? labels.endReasonLeftCompany : labels.endReasonReallocated}</option>)}</select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.company}
        <select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" defaultValue={filters.companyId ?? ""} name="companyId">
          <option value="">{labels.all}</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.organization}
        <select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" defaultValue={filters.vendorAccountId ?? ""} name="vendorAccountId">
          <option value="">{labels.all}</option>
          {vendorAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.licenseType}
        <select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" defaultValue={filters.licenseTypeId ?? ""} name="licenseTypeId">
          <option value="">{labels.all}</option>
          {licenseTypes.map((licenseType) => <option key={licenseType.id} value={licenseType.id}>{licenseType.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.openState}
        <select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" defaultValue={filters.openState ?? ""} name="openState">
          <option value="">{labels.all}</option>
          <option value="open">{labels.open}</option>
          <option value="closed">{labels.closed}</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.dateFrom}
        <input className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" defaultValue={filters.startDate ?? ""} name="startDate" type="date" />
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.dateTo}
        <input className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" defaultValue={filters.endDate ?? ""} name="endDate" type="date" />
      </label>
      <button className="min-h-11 rounded bg-primary px-4 font-semibold text-on-primary" type="submit">
        {labels.apply}
      </button>
    </form>
  );
}
