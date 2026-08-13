import type { VendorAccountDetail } from "@/modules/vendor-catalog/vendor-account-repository";

export interface CapabilityCardLabels {
  readonly canDeprovision: string;
  readonly canProvision: string;
  readonly fallback: string;
  readonly hasCostData: string;
  readonly hasUsageData: string;
  readonly identityMatching: string;
  readonly identityValues: Record<VendorAccountDetail["capabilities"]["identityMatching"], string>;
  readonly notSupported: string;
  readonly protocol: string;
  readonly protocolValues: Record<VendorAccountDetail["capabilities"]["provisioningProtocol"], string>;
  readonly supported: string;
  readonly title: string;
}

function SupportValue({ supported, labels }: { readonly supported: boolean; readonly labels: CapabilityCardLabels }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium text-text-primary">
      <span aria-hidden="true">{supported ? "✓" : "—"}</span>
      {supported ? labels.supported : labels.notSupported}
    </span>
  );
}

export function CapabilityCard({ capabilities, labels }: {
  readonly capabilities: VendorAccountDetail["capabilities"];
  readonly labels: CapabilityCardLabels;
}) {
  const booleanFacts = [
    [labels.canProvision, capabilities.canProvision],
    [labels.canDeprovision, capabilities.canDeprovision],
    [labels.hasUsageData, capabilities.hasUsageData],
    [labels.hasCostData, capabilities.hasCostData],
  ] as const;
  return (
    <section aria-labelledby="vendor-capabilities-title" className="rounded border border-border bg-surface p-5" role="region">
      <h2 className="font-display text-xl font-semibold text-text-primary" id="vendor-capabilities-title">{labels.title}</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {booleanFacts.map(([label, supported]) => (
          <div key={label}>
            <dt className="text-sm text-text-muted">{label}</dt>
            <dd className="mt-1"><SupportValue labels={labels} supported={supported} /></dd>
          </div>
        ))}
        <div>
          <dt className="text-sm text-text-muted">{labels.protocol}</dt>
          <dd className="mt-1 font-medium text-text-primary">{labels.protocolValues[capabilities.provisioningProtocol]}</dd>
        </div>
        <div>
          <dt className="text-sm text-text-muted">{labels.identityMatching}</dt>
          <dd className="mt-1 font-medium text-text-primary">{labels.identityValues[capabilities.identityMatching]}</dd>
        </div>
      </dl>
      <p className="mt-4 rounded bg-info-bg p-3 text-sm text-info-text">{labels.fallback}</p>
    </section>
  );
}
