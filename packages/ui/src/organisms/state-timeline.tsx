export interface StateTimelineProps {
  readonly items: readonly {
    readonly id: string;
    readonly from: string | null;
    readonly to: string;
    readonly actor: string;
    readonly note: string | null;
    readonly occurredAt: string;
    readonly occurredAtLabel: string;
  }[];
}

export function StateTimeline({ items }: StateTimelineProps) {
  return (
    <section data-organism="state-timeline">
      <ol className="relative space-y-0">
        {items.map((item, index) => (
          <li
            className="relative grid grid-cols-[1.5rem_1fr] gap-3 pb-6 last:pb-0"
            key={item.id}
          >
            <div aria-hidden="true" className="relative flex justify-center">
              {index < items.length - 1 ? (
                <span className="absolute bottom-0 top-3 w-px bg-border" />
              ) : null}
              <span className="relative mt-2 size-2.5 rounded-full border-2 border-primary bg-surface" />
            </div>
            <article className="min-w-0 rounded-lg border border-border bg-surface px-4 py-3">
              <p className="font-medium text-text-primary">
                {item.from ? (
                  <>
                    <span>{item.from}</span>
                    <span aria-hidden="true"> → </span>
                  </>
                ) : null}
                <span>{item.to}</span>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
                <span>{item.actor}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={item.occurredAt}>{item.occurredAtLabel}</time>
              </div>
              {item.note ? (
                <p className="mt-2 border-l-2 border-border pl-3 text-sm text-text-secondary">
                  {item.note}
                </p>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
