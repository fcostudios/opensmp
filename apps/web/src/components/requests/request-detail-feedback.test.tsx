// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { formatUsd } from "@smp/ui";

import messages from "../../../messages/en-US.json";
import { RequestDetailFeedback } from "./request-detail-feedback";
import type { RequestFormLabels } from "./request-form";

const labels = messages.requestIntake as RequestFormLabels;

afterEach(cleanup);

describe("RequestDetailFeedback", () => {
  test("keeps created and persisted warning feedback observable after navigation", () => {
    render(
      <RequestDetailFeedback
        created
        labels={labels}
        locale="en-US"
        warnings={[
          { code: "unknown_email_domain" },
          { code: "missing_rate" },
          {
            code: "budget_headroom",
            budgetMonthlyUsd: 100,
            committedRunRateUsd: 80,
            monthlyRateUsd: 30,
            projectedRunRateUsd: 110,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("success").textContent).toContain(labels.success);
    expect(screen.getByTestId("domain_warning").textContent).toBe(
      labels.unknownDomain,
    );
    expect(screen.getByTestId("missing_rate").textContent).toBe(
      labels.missingRate,
    );
    expect(screen.getByTestId("budget_warning").textContent).toBe(
      labels.budgetWarning
        .replace("{budget}", formatUsd(100, "en-US"))
        .replace("{committed}", formatUsd(80, "en-US"))
        .replace("{projected}", formatUsd(110, "en-US")),
    );
  });

  test("does not claim a request was just created on an ordinary detail visit", () => {
    render(
      <RequestDetailFeedback
        created={false}
        labels={labels}
        locale="en-US"
        warnings={[]}
      />,
    );
    expect(screen.queryByTestId("success")).toBeNull();
  });
});
