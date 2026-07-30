// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import {
  useRef,
  type ComponentProps,
} from "react";
import { afterEach, expect, test } from "vitest";

import {
  restoreRetryFocus,
  shouldRestoreRetryFocus,
  useDecisionRetryFocus,
  type DecisionRetryTarget,
} from "./decision-retry-focus";

afterEach(cleanup);

const controlLabels = {
  approve: "approve retry",
  reject: "reject retry",
} as const;

test.each([
  [null, false, "approved", false],
  ["failure", true, "approved", false],
  ["failure", false, null, false],
  ["failure", false, "approved", true],
] as const)(
  "retry focus eligibility is error=%s pending=%s target=%s -> %s",
  (error, pending, target, expected) => {
    expect(shouldRestoreRetryFocus({ error, pending, target })).toBe(expected);
  },
);

test("does not attempt focus when the retry control is absent", () => {
  expect(restoreRetryFocus(null)).toBe(false);
});

test("focuses a present enabled retry control", () => {
  const control = document.createElement("button");
  document.body.append(control);

  expect(restoreRetryFocus(control)).toBe(true);
  expect(document.activeElement).toBe(control);
});

test("does not focus either control without an active failure", () => {
  const view = render(
    <RetryControls error={null} pending={false} target={null} />,
  );
  const approve = view.getByRole("button", { name: controlLabels.approve });
  const reject = view.getByRole("button", { name: controlLabels.reject });

  expect(document.activeElement).not.toBe(approve);
  expect(document.activeElement).not.toBe(reject);
});

function RetryControls({
  error,
  pending,
  target,
}: {
  readonly error: string | null;
  readonly pending: boolean;
  readonly target: DecisionRetryTarget | null;
}) {
  const approveControl = useRef<HTMLButtonElement>(null);
  const rejectControl = useRef<HTMLButtonElement>(null);
  useDecisionRetryFocus({
    approveControl,
    error,
    pending,
    rejectControl,
    target,
  });
  return (
    <dialog open>
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={pending} ref={approveControl} type="button">
        {controlLabels.approve}
      </button>
      <button disabled={pending} ref={rejectControl} type="button">
        {controlLabels.reject}
      </button>
    </dialog>
  );
}

test.each([
  ["approved", controlLabels.approve],
  ["rejected", controlLabels.reject],
] as const)(
  "focuses the enabled %s control only after pending ends",
  (target, expectedName) => {
    const initial: ComponentProps<typeof RetryControls> = {
      error: "No pudimos registrar la decisión.",
      pending: true,
      target,
    };
    const view = render(<RetryControls {...initial} />);
    const expected = view.getByRole("button", { name: expectedName });

    expect((expected as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).not.toBe(expected);

    view.rerender(<RetryControls {...initial} pending={false} />);

    expect((expected as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(expected);
    expect(view.getByRole("alert")).toBeTruthy();
  },
);
