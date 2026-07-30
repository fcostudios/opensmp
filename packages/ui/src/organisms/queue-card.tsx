import type { ReactNode } from "react";

export interface QueueCardProps {
  readonly actions: ReactNode;
  readonly aging: ReactNode;
  readonly cardId: string;
  readonly company: string;
  readonly context: ReactNode;
  readonly justification: string;
  readonly requestLink: ReactNode;
  readonly requester: string;
  readonly requesterEmail: string;
}

export function QueueCard({
  actions,
  aging,
  cardId,
  company,
  context,
  justification,
  requestLink,
  requester,
  requesterEmail,
}: QueueCardProps) {
  return (
    <article
      className="grid gap-5 rounded border border-border bg-surface p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto]"
      data-organism="queue-card"
      data-testid={cardId}
    >
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
              {requestLink}
            </p>
            <h3 className="font-display text-xl font-semibold text-text-primary">
              {requester}
            </h3>
            <p className="text-sm text-text-muted">{requesterEmail}</p>
            <p className="text-sm text-text-secondary">{company}</p>
          </div>
          {aging}
        </header>
        {context}
        <p className="border-l-2 border-primary pl-3 text-sm leading-6 text-text-secondary">
          {justification}
        </p>
      </div>
      <div className="flex min-w-40 flex-col justify-end gap-2">{actions}</div>
    </article>
  );
}
