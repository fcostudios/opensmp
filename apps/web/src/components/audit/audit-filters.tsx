import type { AuditFilters as AuditFilterValues } from "@/modules/audit/types";

interface AuditFilterLabels {
  readonly action: string;
  readonly actor: string;
  readonly all: string;
  readonly applyFilters: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly entity: string;
}

export interface AuditFiltersProps {
  readonly actions: readonly string[];
  readonly actors: readonly {
    readonly id: string;
    readonly email: string;
  }[];
  readonly entityTypes: readonly string[];
  readonly filters: AuditFilterValues;
  readonly labels: AuditFilterLabels;
}

export function AuditFilters({
  actions,
  actors,
  entityTypes,
  filters,
  labels,
}: AuditFiltersProps) {
  return (
    <form
      className="grid gap-4 rounded border border-border bg-surface p-4 md:grid-cols-3"
      data-testid="audit_filters"
      method="get"
    >
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.entity}
        <select
          className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
          defaultValue={filters.entityType ?? ""}
          name="entityType"
        >
          <option value="">{labels.entity}</option>
          {entityTypes.map((entityType) => (
            <option key={entityType} value={entityType}>
              {entityType}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.action}
        <select
          className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
          defaultValue={filters.action ?? ""}
          name="action"
        >
          <option value="">{labels.action}</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.actor}
        <select
          className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
          defaultValue={filters.actor ?? ""}
          name="actor"
        >
          <option value="">{labels.all}</option>
          <option value="system">{labels.actor} · —</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.email}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.dateFrom}
        <input
          className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
          defaultValue={filters.startDate ?? ""}
          name="startDate"
          type="date"
        />
      </label>
      <label className="grid gap-1 text-sm text-text-secondary">
        {labels.dateTo}
        <input
          className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
          defaultValue={filters.endDate ?? ""}
          name="endDate"
          type="date"
        />
      </label>
      <button
        className="min-h-11 self-end rounded bg-primary px-4 font-semibold text-on-primary"
        type="submit"
      >
        {labels.applyFilters}
      </button>
    </form>
  );
}
