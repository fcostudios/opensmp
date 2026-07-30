export interface PoolTileSnapshot {
  readonly assigned: number;
  readonly free: number;
  readonly pendingInvites: number;
  readonly purchased: number;
}

export function PoolTiles({
  idPrefix,
  labels,
  snapshots,
}: {
  readonly idPrefix: "kpi" | "tile";
  readonly labels: {
    readonly assigned: string;
    readonly free: string;
    readonly pending: string;
    readonly purchased: string;
  };
  readonly snapshots: readonly PoolTileSnapshot[];
}) {
  const totals = snapshots.reduce(
    (sum, snapshot) => ({
      assigned: sum.assigned + snapshot.assigned,
      free: sum.free + snapshot.free,
      pending: sum.pending + snapshot.pendingInvites,
      purchased: sum.purchased + snapshot.purchased,
    }),
    { assigned: 0, free: 0, pending: 0, purchased: 0 },
  );
  return (
    <section
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
      data-section={idPrefix === "kpi" ? "kpi_pool_row" : "capacity_tiles"}
    >
      {([
        ["purchased", labels.purchased, totals.purchased],
        ["assigned", labels.assigned, totals.assigned],
        ["pending", labels.pending, totals.pending],
        ["free", labels.free, totals.free],
      ] as const).map(([id, label, value]) => (
        <article
          className="rounded border border-border bg-surface p-4 shadow-sm"
          data-testid={`${idPrefix}_${id}`}
          key={id}
        >
          <p className="text-sm text-text-muted">{label}</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-text-primary">
            {value}
          </p>
        </article>
      ))}
    </section>
  );
}
