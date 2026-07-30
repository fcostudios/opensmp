// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import esMessages from "../../../messages/es-EC.json";
import type { StartOffboardingActionState } from "../../modules/org-registry/actions/people";
import {
  PersonOffboarding,
  type PersonOffboardingLabels,
} from "./person-offboarding";

const personId = "00000000-0000-0000-0000-000000000401";
const labels = esMessages.people as PersonOffboardingLabels;

afterEach(cleanup);

describe("PersonOffboarding", () => {
  test("renders default, submitting, and success states through its action port", async () => {
    let finish:
      | ((result: StartOffboardingActionState) => void)
      | undefined;
    const submitted: unknown[] = [];
    const user = userEvent.setup();
    render(
      <PersonOffboarding
        action={async (input) => {
          submitted.push(input);
          return new Promise((resolve) => {
            finish = resolve;
          });
        }}
        labels={labels}
        personId={personId}
      />,
    );

    const opener = screen.getByTestId("btn_start_offboarding");
    await user.click(opener);
    const confirm = screen.getByTestId(
      "btn_confirm_offboarding",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await user.selectOptions(
      screen.getByLabelText(labels.offboardingReason),
      "inactive",
    );
    await user.type(
      screen.getByLabelText(labels.offboardingNote),
      "No activity for 90 days",
    );
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);

    expect(submitted).toEqual([
      {
        personId,
        endReason: "inactive",
        note: "No activity for 90 days",
      },
    ]);
    await waitFor(() => {
      expect(confirm.disabled).toBe(true);
      expect(confirm.textContent).toBe(labels.offboardingSubmitting);
    });

    finish?.({
      ok: true,
      personId,
      status: "offboarding",
      affectedRequestIds: [
        "00000000-0000-0000-0000-000000000402",
      ],
      provisioningActionIds: [
        "00000000-0000-0000-0000-000000000403",
      ],
    });
    expect(
      await screen.findByText(
        "Retiro iniciado. La solicitud está En retiro.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByTestId("modal_offboarding") as HTMLDetailsElement)
        .open,
    ).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  test("renders the stable error state and keeps the form available to retry", async () => {
    const user = userEvent.setup();
    render(
      <PersonOffboarding
        action={async () => ({
          ok: false,
          globalError: "person_offboarding_unavailable",
        })}
        labels={labels}
        personId={personId}
      />,
    );

    await user.click(screen.getByTestId("btn_start_offboarding"));
    await user.type(
      screen.getByLabelText(labels.offboardingNote),
      "Confirmed by People Ops",
    );
    await user.click(screen.getByTestId("btn_confirm_offboarding"));

    expect(
      await screen.findByText(
        "No hay una licencia activa con una solicitud activa que pueda pasar a En retiro.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByTestId(
        "btn_confirm_offboarding",
      ) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("modal_offboarding") as HTMLDetailsElement)
        .open,
    ).toBe(true);
  });
});
