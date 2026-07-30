import Link from "next/link";

import { PoolGauge, type PoolGaugeLabels } from "@smp/ui";

import type { VendorPoolSnapshot } from "@/modules/vendor-catalog/pool-repository";

export interface PoolCardsLabels extends PoolGaugeLabels {
  readonly attention: string;
  readonly automated: string;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly floor: string;
  readonly mode: string;
  readonly orchestration: string;
  readonly renewal: string;
}

export function poolSnapshotKey(
  item: Pick<VendorPoolSnapshot, "licenseTypeId" | "vendorAccountId">,
): string {
  return `${item.vendorAccountId}:${item.licenseTypeId}`;
}

export function PoolCards({
  items,
  labels,
  locale,
}: {
  readonly items: readonly VendorPoolSnapshot[];
  readonly labels: PoolCardsLabels;
  readonly locale: "es-EC" | "en-US";
}) {
  if (items.length === 0) {
    return (
      <section
        className="rounded border border-border bg-surface p-8 text-center"
        role="status"
      >
        <h2 className="font-display text-xl font-semibold text-text-primary">
          {labels.emptyTitle}
        </h2>
        <p className="mt-2 text-text-secondary">{labels.emptyDescription}</p>
      </section>
    );
  }

  return (
    <section
      aria-live="polite"
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      data-section="pool_cards"
    >
      {items.map((item) => {
        const snapshotKey = poolSnapshotKey(item);
        return (
          <article
            className={`rounded border bg-surface p-5 shadow-sm ${
              item.isLow ? "border-primary" : "border-border"
            }`}
            data-pool-state={
              item.free < 0
                ? "discrepancy"
                : item.isLow
                  ? "attention"
                  : "ok"
            }
            data-snapshot-key={snapshotKey}
            data-testid={`pool_card_${item.vendorAccountId}_${item.licenseTypeId}`}
            key={snapshotKey}
          >
            <header className="mb-5 flex items-start justify-between gap-3 border-b border-border pb-4">
              <div className="min-w-0">
                <Link
                  className="font-display text-xl font-semibold text-text-primary underline-offset-4 hover:underline"
                  href={`/organizaciones/${encodeURIComponent(item.vendorAccountId)}`}
                >
                  {item.vendorAccountName}
                </Link>
                <p className="mt-1 font-mono text-xs uppercase tracking-wide text-text-muted">
                  {item.licenseTypeName}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-neutral-bg px-3 py-1 text-xs font-semibold text-neutral-text">
                {item.mode === "automated"
                  ? labels.automated
                  : labels.orchestration}
              </span>
            </header>
            <PoolGauge
              assigned={item.assigned}
              free={item.free}
              labels={labels}
              lowPoolFloor={item.lowPoolFloor}
              pendingInvites={item.pendingInvites}
              purchased={item.purchased}
            />
            <dl className="mt-5 grid gap-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">{labels.floor}</dt>
                <dd className="font-mono text-text-primary">
                  {item.lowPoolFloor}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">{labels.renewal}</dt>
                <dd className="text-text-primary">
                  {item.contractRenewalOn
                    ? new Intl.DateTimeFormat(locale, {
                        dateStyle: "long",
                        timeZone: "UTC",
                      }).format(
                        new Date(`${item.contractRenewalOn}T00:00:00Z`),
                      )
                    : "—"}
                </dd>
              </div>
            </dl>
            {item.isLow ? (
              <p className="mt-4 rounded bg-pending-bg px-3 py-2 text-sm font-semibold text-pending-text">
                {labels.attention}
              </p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
