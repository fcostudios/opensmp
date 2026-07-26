export interface AuditTrailViewerLabels {
  readonly added: string;
  readonly after: string;
  readonly before: string;
  readonly note: string;
  readonly removed: string;
}

export interface AuditTrailViewerProps {
  readonly after: unknown;
  readonly before: unknown;
  readonly labels: AuditTrailViewerLabels;
  readonly note: string | null;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 2);
}

export function AuditTrailViewer({
  after,
  before,
  labels,
  note,
}: AuditTrailViewerProps) {
  const beforeRecord = record(before);
  const afterRecord = record(after);
  const removed = Object.keys(beforeRecord).filter(
    (key) => !(key in afterRecord),
  );
  const added = Object.keys(afterRecord).filter(
    (key) => !(key in beforeRecord),
  );

  return (
    <section
      className="space-y-4"
      data-organism="audit-trail-viewer"
    >
      {note ? (
        <div>
          <h3 className="text-sm font-semibold text-text-secondary">
            {labels.note}
          </h3>
          <p className="mt-1 text-text-primary">{note}</p>
        </div>
      ) : null}
      {removed.length > 0 || added.length > 0 ? (
        <div className="grid gap-2">
          {removed.map((key) => (
            <div
              className="rounded bg-error-bg px-3 py-2 text-error-text"
              key={`removed-${key}`}
            >
              <span aria-label={labels.removed}>− {key}</span>
            </div>
          ))}
          {added.map((key) => (
            <div
              className="rounded bg-success-bg px-3 py-2 text-success"
              key={`added-${key}`}
            >
              <span aria-label={labels.added}>+ {key}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-text-secondary">
            {labels.before}
          </h3>
          <pre className="mt-2 overflow-auto rounded bg-surface-muted p-4 font-mono text-sm text-text-primary">
            {display(before)}
          </pre>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-secondary">
            {labels.after}
          </h3>
          <pre className="mt-2 overflow-auto rounded bg-surface-muted p-4 font-mono text-sm text-text-primary">
            {display(after)}
          </pre>
        </div>
      </div>
    </section>
  );
}
