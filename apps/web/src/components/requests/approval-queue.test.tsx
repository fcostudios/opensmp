// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import esMessages from "../../../messages/es-EC.json";
import {
  ApprovalQueue,
  type ApprovalQueueLabels,
} from "./approval-queue";
import { approvalAgingTone } from "./approval-aging";
import { DecisionDialogError } from "./decision-dialog-error";

const labels = esMessages.approvalQueue as ApprovalQueueLabels;
const item = {
  requestId: "20000000-0000-0000-0000-000000000001",
  requestNo: "APR-1",
  requesterName: "María Andrade",
  requesterEmail: "maria@example.test",
  state: "pending_approval" as const,
  companyName: "Kickoff",
  licenseTypeName: "Claude Team",
  vendorAccountName: "Org central",
  justification: "Preparar propuestas comerciales",
  neededBy: "2026-08-05",
  createdAt: new Date("2026-07-24T15:00:00.000Z"),
  monthlyRateUsd: null,
  budgetHeadroomUsd: null,
  budgetMonthlyUsd: null,
  committedRunRateUsd: 54.2,
  hasUnpricedCommitments: false,
  projectedHeadroomUsd: null,
  businessHoursPending: 49,
  decisionTargetBreached: true,
};

afterEach(cleanup);

describe("ApprovalQueue", () => {
  test("focuses, scrolls, and identifies only the authorized current target", async () => {
    const scrollIntoView = vi.fn();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const target = {
      ...item,
      requestId: "20000000-0000-4000-8000-000000000002",
      requestNo: "APR-2",
    };

    render(
      <ApprovalQueue
        items={[item, target]}
        labels={labels}
        locale="es-EC"
        targetRequestId={target.requestId}
      />,
    );

    const targetCard = screen.getByTestId(
      `approval_target_${target.requestId}`,
    );
    await waitFor(() => expect(document.activeElement).toBe(targetCard));
    expect(targetCard.id).toBe(`approval-request-${target.requestId}`);
    expect(targetCard.getAttribute("aria-current")).toBe("true");
    expect(targetCard.getAttribute("tabindex")).toBe("-1");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(
      screen
        .getByTestId(`approval_target_${item.requestId}`)
        .hasAttribute("aria-current"),
    ).toBe(false);
  });

  test("does not invent a current card for an absent or out-of-scope target", () => {
    const { rerender } = render(
      <ApprovalQueue
        items={[item]}
        labels={labels}
        locale="es-EC"
        targetRequestId={null}
      />,
    );
    expect(screen.queryByRole("article", { current: true })).toBeNull();

    rerender(
      <ApprovalQueue
        items={[item]}
        labels={labels}
        locale="es-EC"
        targetRequestId="20000000-0000-4000-8000-000000000099"
      />,
    );
    expect(
      screen
        .getByTestId(`approval_target_${item.requestId}`)
        .hasAttribute("aria-current"),
    ).toBe(false);
  });

  test("renders TOON context, missing rate, headroom, and breach state", () => {
    render(
      <ApprovalQueue
        items={[item]}
        labels={labels}
        locale="es-EC"
      />,
    );

    expect(screen.getByText("María Andrade")).toBeTruthy();
    expect(screen.getByText("maria@example.test")).toBeTruthy();
    expect(screen.getByText("Kickoff")).toBeTruthy();
    expect(screen.getByText("Preparar propuestas comerciales")).toBeTruthy();
    expect(screen.getByTestId("created_at").textContent).toContain("24");
    expect(screen.getByTestId("request_state").textContent).toBe(
      labels.pendingApproval,
    );
    expect(screen.getByTestId(`card_${item.requestId}`)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: item.requestNo }).getAttribute("href"),
    ).toBe(`/solicitudes/${item.requestId}`);
    expect(screen.getByTestId("monthly_rate").textContent).toBe(
      labels.missingRate,
    );
    expect(screen.getByTestId("budget_headroom").textContent).toBe(
      labels.headroomUnavailable,
    );
    expect(screen.getByTestId("aging_chip").dataset.tone).toBe("attention");
  });

  test("renders unpriced committed assignments as unavailable", () => {
    render(
      <ApprovalQueue
        items={[{
          ...item,
          hasUnpricedCommitments: true,
          committedRunRateUsd: null,
        }]}
        labels={labels}
        locale="es-EC"
      />,
    );

    expect(screen.getByTestId("committed_rate").textContent).toBe(
      labels.missingRate,
    );
    expect(screen.getByTestId("budget_headroom").textContent).toBe(
      labels.headroomUnavailable,
    );
  });

  test("opens native confirmation controls and requires a rejection comment", async () => {
    const user = userEvent.setup();
    render(
      <ApprovalQueue
        items={[item]}
        labels={labels}
        locale="es-EC"
      />,
    );

    await user.click(screen.getByTestId(`btn_approve_${item.requestId}`));
    expect(screen.getByTestId("modal_approve")).toBeTruthy();
    expect(screen.getByTestId("btn_confirm_approve")).toBeTruthy();
    expect(screen.getByTestId("btn_cancel_approve")).toBeTruthy();
    await user.click(screen.getByTestId("btn_cancel_approve"));

    await user.click(screen.getByTestId(`btn_reject_${item.requestId}`));
    const confirm = screen.getByTestId("btn_confirm_reject") as HTMLButtonElement;
    expect(screen.getByTestId("decision_comment")).toBeTruthy();
    expect(screen.getByTestId("btn_cancel_reject")).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    await user.type(
      screen.getByLabelText(labels.rejectionComment),
      "Presupuesto comprometido",
    );
    expect(confirm.disabled).toBe(false);
  });

  test("renders the empty state", () => {
    render(
      <ApprovalQueue
        items={[]}
        labels={labels}
        locale="es-EC"
      />,
    );

    expect(screen.getByTestId("approval_empty").textContent).toContain(
      labels.emptyTitle,
    );
  });

  test("renders a localized accessible error inside the active dialog", () => {
    render(
      <dialog open>
        <DecisionDialogError
          message={labels.decisionError}
          testId="approve_decision_error"
        />
      </dialog>,
    );

    expect(screen.getByRole("alert").textContent).toBe(labels.decisionError);
    expect(screen.getByTestId("approve_decision_error")).toBeTruthy();
  });

  test("does not render an alert before a decision fails", () => {
    const { container } = render(
      <DecisionDialogError message={null} testId="decision_error" />,
    );

    expect(container.childElementCount).toBe(0);
  });

  test.each([
    [0, "neutral"],
    [23, "neutral"],
    [24, "warning"],
    [48, "warning"],
    [49, "attention"],
  ] as const)("maps %i business hours to the %s aging tier", (hours, tone) => {
    expect(approvalAgingTone(hours)).toBe(tone);
  });
});
