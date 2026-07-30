import { formatUsd } from "@smp/ui";

import type { RequestWarning } from "@/modules/request-workflow/repository";
import type { RequestFormLabels } from "./request-form";

type RequestFeedbackLabels = Pick<
  RequestFormLabels,
  "success" | "unknownDomain" | "missingRate" | "budgetWarning"
>;

export function RequestDetailFeedback({
  created,
  labels,
  locale,
  warnings,
}: {
  readonly created: boolean;
  readonly labels: RequestFeedbackLabels;
  readonly locale: "es-EC" | "en-US";
  readonly warnings: readonly RequestWarning[];
}) {
  return (
    <div aria-live="polite" className="space-y-2">
      {created ? (
        <p
          className="rounded bg-success-bg p-3 text-sm text-success-text"
          data-testid="success"
          role="status"
        >
          {labels.success}
        </p>
      ) : null}
      {warnings.map((warning) =>
        warning.code === "unknown_email_domain" ? (
          <p
            className="text-sm text-warning-text"
            data-testid="domain_warning"
            key={warning.code}
          >
            {labels.unknownDomain}
          </p>
        ) : warning.code === "missing_rate" ? (
          <p
            className="text-sm text-warning-text"
            data-testid="missing_rate"
            key={warning.code}
          >
            {labels.missingRate}
          </p>
        ) : (
          <p
            className="text-sm text-warning-text"
            data-testid="budget_warning"
            key={warning.code}
          >
            {labels.budgetWarning
              .replace(
                "{budget}",
                formatUsd(warning.budgetMonthlyUsd, locale),
              )
              .replace(
                "{committed}",
                formatUsd(warning.committedRunRateUsd, locale),
              )
              .replace(
                "{projected}",
                formatUsd(warning.projectedRunRateUsd, locale),
              )}
          </p>
        ),
      )}
    </div>
  );
}
