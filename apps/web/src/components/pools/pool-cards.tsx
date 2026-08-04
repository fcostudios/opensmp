import Link from "next/link";

import { PoolGauge, type PoolGaugeLabels } from "@smp/ui";

import type { VendorPoolSnapshot } from "@/modules/vendor-catalog/pool-repository";
import { registerPurchase } from "@/modules/vendor-catalog/actions/manage-capacity";

export interface PoolCardsLabels extends PoolGaugeLabels {
  readonly addCapacity: string;
  readonly attention: string;
  readonly automated: string;
  readonly candidateTitle: string;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly effectiveFrom: string;
  readonly effectiveFromField: string;
  readonly escalated: string;
  readonly floor: string;
  readonly mode: string;
  readonly lastActive: string;
  readonly monthlyCost: string;
  readonly noUsageData: string;
  readonly note: string;
  readonly orchestration: string;
  readonly prorationNote: string;
  readonly purchasedQty: string;
  readonly renewal: string;
  readonly saveCapacity: string;
}

function formatDate(value: string, locale: "es-EC" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
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
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">{labels.effectiveFrom}</dt>
                <dd className="text-text-primary">
                  {formatDate(item.effectiveFrom, locale)}
                </dd>
              </div>
            </dl>
            {item.isLow ? (
              <p className="mt-4 rounded bg-pending-bg px-3 py-2 text-sm font-semibold text-pending-text">
                {labels.attention}
              </p>
            ) : null}
            {item.blockedRequests.length > 0 ? (
              <section
                className="mt-4 space-y-3 rounded border border-primary bg-pending-bg p-3"
                data-testid="purchase_or_reclaim_callout"
              >
                {item.blockedRequests.map((request) => (
                  <div className="flex items-center justify-between gap-2" key={request.id}>
                    <Link
                      className="font-mono text-sm font-semibold text-pending-text underline-offset-4 hover:underline"
                      href={`/solicitudes/${request.id}`}
                    >
                      {request.requestNo}
                    </Link>
                    <span className="text-sm text-pending-text">
                      {request.businessDaysBlocked}
                    </span>
                    {request.escalated ? (
                      <span className="rounded-full bg-critical-bg px-2 py-1 text-xs font-semibold text-critical-text">
                        {labels.escalated}
                      </span>
                    ) : null}
                  </div>
                ))}
                <p className="text-sm text-pending-text">
                  {item.decisionEvidence.type === "no_data"
                    ? labels.noUsageData
                    : labels.candidateTitle}
                </p>
                {item.decisionEvidence.type === "candidates" ? (
                  <ul className="space-y-2" data-testid="reclaim_candidates">
                    {item.decisionEvidence.items.map((candidate) => (
                      <li className="rounded bg-surface p-2 text-sm text-text-secondary" key={candidate.assignmentId}>
                        <span>{labels.lastActive}: {formatDate(candidate.lastActiveOn, locale)}</span>
                        <span className="ml-3">
                          {labels.monthlyCost}: {new Intl.NumberFormat(locale, {
                            currency: "USD",
                            style: "currency",
                          }).format(candidate.monthlyCostUsd)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-sm text-pending-text">{labels.prorationNote}</p>
              </section>
            ) : null}
            <details className="mt-4 rounded border border-border p-3">
              <summary
                className="cursor-pointer font-semibold text-text-primary"
                role="button"
              >
                {labels.addCapacity}
              </summary>
              <div aria-label={labels.addCapacity} className="mt-3" role="dialog">
                <form action={registerPurchase} className="grid gap-3">
                  <input name="vendorAccountId" type="hidden" value={item.vendorAccountId} />
                  <input name="licenseTypeId" type="hidden" value={item.licenseTypeId} />
                  <label className="grid gap-1 text-sm text-text-secondary">
                    {labels.purchasedQty}
                    <input
                      className="rounded border border-border bg-surface px-3 py-2 text-text-primary"
                      defaultValue={item.purchased + 1}
                      min="1"
                      name="purchasedQty"
                      required
                      type="number"
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-text-secondary">
                    {labels.effectiveFromField}
                    <input
                      className="rounded border border-border bg-surface px-3 py-2 text-text-primary"
                      name="effectiveFrom"
                      required
                      type="date"
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-text-secondary">
                    {labels.note}
                    <textarea
                      className="rounded border border-border bg-surface px-3 py-2 text-text-primary"
                      maxLength={1000}
                      name="note"
                    />
                  </label>
                  <button
                    className="rounded bg-primary px-3 py-2 font-semibold text-on-primary"
                    type="submit"
                  >
                    {labels.saveCapacity}
                  </button>
                </form>
              </div>
            </details>
          </article>
        );
      })}
    </section>
  );
}
