import Link from "next/link";

import {
  checklistFailureReasonLabel,
  checklistExceptionStatusLabel,
  checklistRequestHref,
} from "./checklist-exception-presenter";

export interface ChecklistExceptionItem {
  readonly actionId: string;
  readonly companyName: string;
  readonly failureReason: string;
  readonly kind: "checklist";
  readonly mode: "orchestration";
  readonly personEmail: string;
  readonly requestId: string;
  readonly requestNo: string;
  readonly sentAt: string | null;
  readonly status: "failed" | "verification_failed";
  readonly vendorAccountName: string;
  readonly vendorRef: string | null;
}

export interface ChecklistExceptionsLabels {
  readonly action: string;
  readonly empty: string;
  readonly failureAssignmentMissing: string;
  readonly kindChecklist: string;
  readonly mode: string;
  readonly modeOrchestration: string;
  readonly noData: string;
  readonly organization: string;
  readonly reason: string;
  readonly retryProvisioning: string;
  readonly retryUnavailable: string;
  readonly request: string;
  readonly sentAt: string;
  readonly status: string;
  readonly statusFailed: string;
  readonly statusVerificationFailed: string;
  readonly viewRequest: string;
  readonly vendorReference: string;
}

function DeferredRetry({
  labels,
}: {
  readonly labels: ChecklistExceptionsLabels;
}) {
  return (
    <div className="mb-3 flex items-center justify-end gap-3">
      <span className="text-sm text-text-muted">{labels.retryUnavailable}</span>
      <button
        className="rounded border border-border px-3 py-2 text-sm font-semibold text-text-muted"
        data-testid="btn_retry_provisioning"
        disabled
        title={labels.retryUnavailable}
        type="button"
      >
        {labels.retryProvisioning}
      </button>
    </div>
  );
}

export function ChecklistExceptionsList({
  failures,
  labels,
  locale = "es-EC",
}: {
  readonly failures: readonly ChecklistExceptionItem[];
  readonly labels: ChecklistExceptionsLabels;
  readonly locale?: "en-US" | "es-EC";
}) {
  if (failures.length === 0) {
    return (
      <div className="mt-5" data-testid="table_failed">
        <DeferredRetry labels={labels} />
        <p className="rounded border border-dashed border-border p-6 text-center text-text-secondary">
          {labels.empty}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5" data-testid="table_failed">
      <DeferredRetry labels={labels} />
      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border text-sm text-text-secondary">
            <th className="px-3 py-2 font-medium" data-testid="solicitud" scope="col">
              {labels.request}
            </th>
            <th className="px-3 py-2 font-medium" data-testid="organizacion" scope="col">
              {labels.organization}
            </th>
            <th className="px-3 py-2 font-medium" data-testid="accion" scope="col">
              {labels.action}
            </th>
            <th className="px-3 py-2 font-medium" data-testid="modo" scope="col">
              {labels.mode}
            </th>
            <th className="px-3 py-2 font-medium" data-testid="vendor_ref" scope="col">
              {labels.vendorReference}
            </th>
            <th className="px-3 py-2 font-medium" data-testid="enviada" scope="col">
              {labels.sentAt}
            </th>
            <th className="px-3 py-2 font-medium" data-testid="estado" scope="col">
              {labels.status}
            </th>
            <th className="px-3 py-2 font-medium" data-testid="motivo" scope="col">
              {labels.reason}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {failures.map((failure) => {
            const href = checklistRequestHref(failure.requestId);
            const requestTrace = `${failure.requestNo} · ${failure.personEmail}`;
            return (
              <tr key={failure.actionId}>
                <td className="px-3 py-3">
                  {href ? (
                    <Link
                      className="font-semibold text-text-primary underline-offset-4 hover:underline"
                      href={href}
                    >
                      {requestTrace}
                    </Link>
                  ) : (
                    <span className="font-semibold text-text-primary">
                      {requestTrace}
                    </span>
                  )}
                  <span className="mt-1 block font-mono text-xs text-text-secondary">
                    {failure.actionId}
                  </span>
                </td>
                <td className="px-3 py-3 text-text-secondary">
                  {failure.companyName} · {failure.vendorAccountName}
                </td>
                <td className="px-3 py-3 text-text-secondary">
                  {labels.kindChecklist}
                </td>
                <td className="px-3 py-3 text-text-secondary">
                  {labels.modeOrchestration}
                </td>
                <td className="px-3 py-3 font-mono text-text-secondary">
                  {failure.vendorRef ?? labels.noData}
                </td>
                <td className="px-3 py-3 text-text-secondary">
                  {failure.sentAt ? (
                    <time dateTime={failure.sentAt}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(failure.sentAt))}
                    </time>
                  ) : (
                    labels.noData
                  )}
                </td>
                <td
                  className="px-3 py-3 font-semibold text-text-primary"
                  data-testid={`estado-${failure.actionId}`}
                >
                  {checklistExceptionStatusLabel(failure.status, {
                    failed: labels.statusFailed,
                    verificationFailed: labels.statusVerificationFailed,
                  })}
                </td>
                <td
                  className="max-w-md px-3 py-3 text-text-secondary"
                  data-testid={`motivo-${failure.actionId}`}
                >
                  {checklistFailureReasonLabel(failure.failureReason, {
                    assignmentMissing: labels.failureAssignmentMissing,
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
