// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ProvisioningRetrySubmit } from "./provisioning-retry-submit";

afterEach(cleanup);

it("disables the retry submit and exposes its pending state while the action runs", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  render(
    <form action={async () => pending}>
      <ProvisioningRetrySubmit
        label="Reintentar aprovisionamiento"
        pendingLabel="Reintentando…"
        testId="retry"
      />
    </form>,
  );
  const button = screen.getByTestId("retry");
  expect(button).toHaveProperty("disabled", false);
  expect(button.textContent).toBe("Reintentar aprovisionamiento");

  fireEvent.submit(button.closest("form")!);
  await waitFor(() => expect(button).toHaveProperty("disabled", true));
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toBe("Reintentando…");
  finish();
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
});
