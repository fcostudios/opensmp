export interface PoolGaugeLabels {
  readonly assigned: string;
  readonly available: string;
  readonly discrepancy: string;
  readonly pending: string;
  readonly purchased: string;
}

export interface PoolGaugeProps {
  readonly assigned: number;
  readonly free: number;
  readonly labels: PoolGaugeLabels;
  readonly lowPoolFloor: number;
  readonly pendingInvites: number;
  readonly purchased: number;
}

export function PoolGauge({
  assigned,
  free,
  labels,
  lowPoolFloor,
  pendingInvites,
  purchased,
}: PoolGaugeProps) {
  const state =
    free < 0 ? "discrepancy" : free < lowPoolFloor ? "attention" : "ok";
  const denominator = Math.max(purchased, assigned + pendingInvites, 1);
  const assignedWidth = `${Math.min(100, (assigned / denominator) * 100)}%`;
  const pendingWidth = `${Math.min(
    100,
    (pendingInvites / denominator) * 100,
  )}%`;
  const freeWidth = `${Math.min(100, (Math.max(free, 0) / denominator) * 100)}%`;
  const summary = `${labels.purchased} ${purchased}; ${labels.assigned} ${assigned}; ${labels.pending} ${pendingInvites}; ${labels.available} ${free}`;

  return (
    <section
      aria-label={summary}
      className="space-y-4"
      data-organism="pool-gauge"
      data-pool-state={state}
    >
      <div
        aria-hidden="true"
        className="flex h-3 overflow-hidden rounded-full bg-surface-muted"
      >
        <span className="bg-text-secondary" style={{ width: assignedWidth }} />
        <span className="bg-primary" style={{ width: pendingWidth }} />
        <span className="bg-success" style={{ width: freeWidth }} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {[
          [labels.purchased, purchased],
          [labels.assigned, assigned],
          [labels.pending, pendingInvites],
          [labels.available, free],
        ].map(([label, value]) => (
          <div key={label} className="border-l border-border pl-3">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="font-mono text-xl font-semibold text-text-primary">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {free < 0 ? (
        <p className="rounded bg-error-bg px-3 py-2 text-sm font-semibold text-error-text">
          {labels.discrepancy} {Math.abs(free)}
        </p>
      ) : null}
    </section>
  );
}
