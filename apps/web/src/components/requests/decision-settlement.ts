import type { DecideRequestActionResult } from "./approval-queue.types";
import type { DecisionRetryTarget } from "./decision-retry-focus";

export async function settleDecision(
  pendingResult: Promise<DecideRequestActionResult>,
): Promise<DecideRequestActionResult> {
  try {
    return await pendingResult;
  } catch {
    return { ok: false, error: "decision_failed" };
  }
}

export function decisionSucceeded(
  result: DecideRequestActionResult,
): boolean {
  return result.ok;
}

export function retryTargetAfterDecision(
  result: DecideRequestActionResult,
  decision: DecisionRetryTarget,
): DecisionRetryTarget | null {
  return result.ok ? null : decision;
}
