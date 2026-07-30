// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import type { PersonInput } from "@smp/contracts";

import esMessages from "../../../messages/es-EC.json";
import {
  PersonForm,
  type PersonFormLabels,
} from "./person-form";

const companyA = "00000000-0000-0000-0000-000000000301";
const companyB = "00000000-0000-0000-0000-000000000302";
const requestId = "00000000-0000-0000-0000-000000000303";
const labels = esMessages.people as PersonFormLabels;

afterEach(cleanup);

describe("PersonForm company-move behavior", () => {
  test("requires confirmation through the rendered form and submits to its action port", async () => {
    const submitted: PersonInput[] = [];
    const user = userEvent.setup();
    render(
      <PersonForm
        action={async (input) => {
          submitted.push(input);
          return {
            ok: true,
            personId: input.id,
            reRequestHref: `/solicitudes/${requestId}`,
          };
        }}
        companies={[
          { id: companyA, name: "Company A" },
          { id: companyB, name: "Company B" },
        ]}
        labels={labels}
        mode="edit"
        person={{
          id: "00000000-0000-0000-0000-000000000304",
          fullName: "Andrea",
          email: "andrea@example.com",
          companyId: companyA,
          status: "active",
        }}
      />,
    );

    const save = screen.getByTestId(
      "btn_guardar_persona",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText(labels.company), companyB);

    expect(screen.getByRole("alert").textContent).toContain(
      "Cambiar de compañía cerrará las asignaciones abiertas el día anterior y creará una solicitud fast-track por cada asignación sucesora. Confirma para guardar.",
    );
    expect(save.disabled).toBe(true);
    expect(submitted).toEqual([]);

    await user.click(screen.getByLabelText(labels.confirmCompanyMove));
    expect(save.disabled).toBe(false);
    await user.click(save);

    expect(submitted).toEqual([
      {
        id: "00000000-0000-0000-0000-000000000304",
        fullName: "Andrea",
        email: "andrea@example.com",
        companyId: companyB,
        status: "active",
        confirmCompanyMove: true,
      },
    ]);
    expect(
      (
        await screen.findByRole("link", {
          name: labels.fastTrackLink,
        })
      ).getAttribute("href"),
    ).toBe(`/solicitudes/${requestId}`);
  });

  test("cancel resets controlled fields, closes the dialog, and restores summary focus", async () => {
    const user = userEvent.setup();
    const summaryLabel = "Edit person";
    render(
      <details open>
        <summary>{summaryLabel}</summary>
        <PersonForm
          action={async () => ({ ok: true })}
          companies={[
            { id: companyA, name: "Company A" },
            { id: companyB, name: "Company B" },
          ]}
          labels={labels}
          mode="edit"
          person={{
            id: "00000000-0000-0000-0000-000000000304",
            fullName: "Andrea",
            email: "andrea@example.com",
            companyId: companyA,
            status: "active",
          }}
        />
      </details>,
    );
    await user.clear(screen.getByLabelText(labels.fullName));
    await user.type(screen.getByLabelText(labels.fullName), "Changed");
    await user.selectOptions(screen.getByLabelText(labels.company), companyB);
    await user.click(screen.getByRole("button", { name: labels.cancel }));

    expect(
      (screen.getByLabelText(labels.fullName) as HTMLInputElement).value,
    ).toBe("Andrea");
    expect(
      (screen.getByLabelText(labels.company) as HTMLSelectElement).value,
    ).toBe(companyA);
    expect(
      screen.getByText(summaryLabel).parentElement?.hasAttribute("open"),
    ).toBe(false);
    expect(document.activeElement).toBe(screen.getByText(summaryLabel));
  });

  test("renders localized structured field errors beside invalid controls", async () => {
    const user = userEvent.setup();
    render(
      <PersonForm
        action={async () => ({
          ok: false,
          globalError: "person_validation_failed",
          fieldErrors: {
            fullName: ["Required"],
            email: ["Invalid email"],
            companyId: ["Invalid UUID"],
          },
        })}
        companies={[{ id: companyA, name: "Company A" }]}
        labels={labels}
        mode="create"
      />,
    );
    await user.type(screen.getByLabelText(labels.fullName), "Andrea");
    await user.type(
      screen.getByTestId("email"),
      "andrea@example.com",
    );
    await user.click(screen.getByTestId("btn_save_person"));

    const name = screen.getByTestId("full_name");
    const email = screen.getByTestId("email");
    const company = screen.getByTestId("company_id");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(company.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toContain(
      "create-fullName-error",
    );
    expect(email.getAttribute("aria-describedby")).toContain(
      "create-email-error",
    );
    expect(screen.getByText(labels.fullNameError)).toBeTruthy();
    expect(screen.getByText(labels.emailError)).toBeTruthy();
    expect(screen.getByText(labels.companyError)).toBeTruthy();
  });
});
