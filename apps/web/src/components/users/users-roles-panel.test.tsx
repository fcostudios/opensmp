// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import esMessages from "../../../messages/es-EC.json";
import {
  UsersRolesPanel,
  type UsersRolesLabels,
} from "./users-roles-panel";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

const labels = esMessages.usersRoles as UsersRolesLabels;
const linkedPersonId = "00000000-0000-0000-0000-000000000471";
const companyId = "00000000-0000-0000-0000-000000000472";
const linkedUserId = "00000000-0000-0000-0000-000000000473";
const unlinkedUserId = "00000000-0000-0000-0000-000000000474";
const grantId = "00000000-0000-0000-0000-000000000475";

const users = [
  { id: linkedUserId, email: "linked@example.com", globalRole: null, idpSubject: "kc-linked", lastLoginAt: null, linkedPerson: "Linked Person", personId: linkedPersonId, companyId, status: "active", twoFactorStatus: "configured" },
  { id: unlinkedUserId, email: "unlinked@example.com", globalRole: null, idpSubject: "kc-unlinked", lastLoginAt: null, linkedPerson: null, personId: null, companyId: null, status: "disabled", twoFactorStatus: "pending" },
] as const;
const grants = [
  { id: grantId, userAccountId: linkedUserId, userEmail: "linked@example.com", companyId, companyName: "Company A", role: "approver", validFrom: "2026-08-03", validTo: null },
] as const;
const companies = [{ id: companyId, name: "Company A" }] as const;

function renderPanel(actions?: Partial<React.ComponentProps<typeof UsersRolesPanel>["actions"]>) {
  const noOp = async (_formData: FormData) => undefined;
  return render(
    <UsersRolesPanel
      actions={{ createUser: noOp, disableUser: noOp, resetTwoFactor: noOp, grantRole: noOp, removeRole: noOp, ...actions }}
      companies={companies}
      grants={grants}
      labels={labels}
      locale="es-EC"
      people={[{ id: linkedPersonId, fullName: "Available Person" }]}
      users={users}
    />,
  );
}

function linkedRow(): HTMLElement {
  return within(screen.getByTestId("users_table"))
    .getByText("linked@example.com")
    .closest("tr")!;
}

afterEach(() => {
  cleanup();
  navigation.refresh.mockClear();
});

describe("SCR-users-roles", () => {
  test("routes only linked accounts to their exact person detail and switches exclusive counted tab panels", async () => {
    const user = userEvent.setup();
    renderPanel();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      `${labels.usersTab} (2)`,
      `${labels.rolesTab} (1)`,
    ]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("panel_usuarios");
    expect(screen.getByText("linked@example.com")).toBeTruthy();
    expect(screen.queryByText("Company A")).toBeNull();

    const personLinks = screen.getAllByTestId("btn_view_person");
    expect(personLinks).toHaveLength(1);
    expect(personLinks[0]?.getAttribute("href")).toBe(`/personas/${linkedPersonId}`);
    expect(within(screen.getByText("unlinked@example.com").closest("tr")!).queryByTestId("btn_view_person")).toBeNull();

    await user.click(tabs[1]!);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("panel_roles");
    expect(screen.getByText("Company A")).toBeTruthy();
    expect(screen.queryByText("unlinked@example.com")).toBeNull();
  });

  test("opens the five native dialogs with selected context and closes by cancel or Escape", async () => {
    const user = userEvent.setup();
    renderPanel();

    const assertClose = async (opener: HTMLElement, cancelId: string) => {
      await user.click(opener);
      const dialog = screen.getByRole("dialog");
      expect(dialog.hasAttribute("open")).toBe(true);
      await user.click(within(dialog).getByTestId(cancelId));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(opener);
      });
    };

    await assertClose(screen.getByTestId("btn_new_account"), "btn_cancel_new_account");

    const selectedRow = linkedRow();
    const resetOpener = within(selectedRow).getByTestId("btn_reset_2fa");
    await user.click(resetOpener);
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("linked@example.com")).toBeTruthy();
    expect(within(dialog).getByDisplayValue(linkedUserId).getAttribute("name")).toBe("userAccountId");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(resetOpener);
    });

    await assertClose(within(selectedRow).getByTestId("btn_disable_account"), "btn_cancel_disable");

    await user.click(screen.getByRole("tab", { name: `${labels.rolesTab} (1)` }));
    await assertClose(screen.getByTestId("btn_add_role"), "btn_cancel_add_role");

    const removeOpener = screen.getByTestId("btn_remove_role");
    await user.click(removeOpener);
    dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("linked@example.com");
    expect(dialog.textContent).toContain("Company A");
    expect(within(dialog).getByDisplayValue(grantId).getAttribute("name")).toBe("roleAssignmentId");
    expect(dialog.querySelector('input[name="companyId"]')).toBeNull();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(removeOpener);
    });
  });

  test("maps every dialog to its exact accessible title and submit label", async () => {
    const user = userEvent.setup();
    renderPanel();

    const assertDialogCopy = async (
      opener: HTMLElement,
      title: string,
      submitId: string,
      submitLabel: string,
      cancelId: string,
    ) => {
      await user.click(opener);
      const dialog = screen.getByRole("dialog", { name: title });
      expect(within(dialog).getByRole("heading", { name: title }).textContent).toBe(title);
      expect(within(dialog).getByTestId(submitId).textContent).toBe(submitLabel);
      await user.click(within(dialog).getByTestId(cancelId));
    };

    await assertDialogCopy(screen.getByTestId("btn_new_account"), labels.createAccount, "btn_create_account", labels.createAccount, "btn_cancel_new_account");
    await assertDialogCopy(within(linkedRow()).getByTestId("btn_reset_2fa"), labels.resetTitle, "btn_confirm_reset_2fa", labels.confirmReset, "btn_cancel_reset_2fa");
    await assertDialogCopy(within(linkedRow()).getByTestId("btn_disable_account"), labels.disableTitle, "btn_confirm_disable", labels.confirmDisable, "btn_cancel_disable");
    await user.click(screen.getByTestId("tab_roles"));
    await assertDialogCopy(screen.getByTestId("btn_add_role"), labels.addRoleTitle, "btn_confirm_add_role", labels.confirmAddRole, "btn_cancel_add_role");
    await assertDialogCopy(screen.getByTestId("btn_remove_role"), labels.removeRoleTitle, "btn_confirm_remove_role", labels.confirmRemoveRole, "btn_cancel_remove_role");
  });

  test("contains keyboard focus within the dialog in both Tab directions", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("btn_new_account"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("open")).toBe("");

    const first = within(dialog).getByTestId("display_name");
    const last = within(dialog).getByTestId("btn_create_account");
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test("does not let native Escape cancel a dialog while its action is pending", async () => {
    const user = userEvent.setup();
    let resolveAction: (() => void) | undefined;
    renderPanel({
      resetTwoFactor: async () => {
        await {
          then(resolve: (value?: void) => void) {
            resolveAction = () => resolve();
          },
        };
      },
    });

    await user.click(within(linkedRow()).getByTestId("btn_reset_2fa"));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByTestId("reset_note"), "Pending audit reason");
    await user.click(within(dialog).getByTestId("btn_confirm_reset_2fa"));
    const cancelEvent = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toBe(dialog);

    resolveAction?.();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("renders every specified modal description, field help, and placeholder without credential inputs", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId("btn_new_account"));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Crea una cuenta de acceso y vincúlala a una persona del directorio. La persona recibirá un correo para configurar su contraseña y su 2FA.")).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("nombre@compania.ec")).toBeTruthy();
    expect(within(dialog).getByText("Busca por nombre o correo en el directorio de personas.")).toBeTruthy();
    expect(within(dialog).getByText("Déjalo vacío si la cuenta solo tendrá roles por compañía.")).toBeTruthy();
    await user.click(within(dialog).getByTestId("btn_cancel_new_account"));

    const selectedRow = linkedRow();
    await user.click(within(selectedRow).getByTestId("btn_reset_2fa"));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Se invalidará el TOTP actual de la cuenta y la persona deberá configurarlo de nuevo en su próximo ingreso.")).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("Ej.: cambió de teléfono y perdió el autenticador")).toBeTruthy();
    await user.click(within(dialog).getByTestId("btn_cancel_reset_2fa"));

    await user.click(within(selectedRow).getByTestId("btn_disable_account"));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("La cuenta no podrá ingresar y sus roles por compañía dejan de aplicar. Las licencias de la persona no se tocan: si corresponde, inicia el retiro desde la ficha de la persona.")).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("Ej.: salida de la compañía el 30/06/2026")).toBeTruthy();
    await user.click(within(dialog).getByTestId("btn_cancel_disable"));

    await user.click(screen.getByRole("tab", { name: `${labels.rolesTab} (1)` }));
    await user.click(screen.getByTestId("btn_add_role"));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Otorga un rol de aprobación, finanzas o lectura sobre una compañía. La ventana de vigencia es opcional.")).toBeTruthy();
    expect(within(dialog).getByText("Busca por correo de la cuenta.")).toBeTruthy();
    expect(within(dialog).getByText("Ventana de delegación temporal: pendiente (R2). Por ahora define solo la vigencia del rol.")).toBeTruthy();
    await user.click(within(dialog).getByTestId("btn_cancel_add_role"));

    await user.click(screen.getByTestId("btn_remove_role"));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("El usuario dejará de ver y operar esa compañía con este rol. La acción queda registrada en auditoría.")).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("Ej.: fin del encargo de aprobación en Opina")).toBeTruthy();
    expect(within(dialog).queryByLabelText(/password|contrase(?:ñ|n)a|totp secret|secreto|credencial/i)).toBeNull();
  });

  test("waits for action success before toast, close, focus restore, and refresh", async () => {
    const user = userEvent.setup();
    let resolveAction: (() => void) | undefined;
    const submitted: FormData[] = [];
    renderPanel({
      resetTwoFactor: async (formData) => {
        submitted.push(formData);
        await {
          then(resolve: (value?: void) => void) {
            resolveAction = () => resolve();
          },
        };
      },
    });

    const opener = within(linkedRow()).getByTestId("btn_reset_2fa");
    await user.click(opener);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByTestId("reset_note"), "Changed phone");
    await user.click(within(dialog).getByTestId("btn_confirm_reset_2fa"));

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.get("userAccountId")).toBe(linkedUserId);
    expect(submitted[0]?.get("note")).toBe("Changed phone");
    expect((within(dialog).getByTestId("btn_confirm_reset_2fa") as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByTestId("btn_confirm_reset_2fa").textContent).toBe("Enviando");
    expect(screen.queryByText("2FA restablecido. Queda registrado en auditoría.")).toBeNull();
    expect(navigation.refresh).not.toHaveBeenCalled();

    resolveAction?.();
    expect((await screen.findByRole("status")).textContent).toBe("2FA restablecido. Queda registrado en auditoría.");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(navigation.refresh).toHaveBeenCalledTimes(1);
    });
  });

  test("keeps a rejected action dialog open with localized retry feedback", async () => {
    const user = userEvent.setup();
    renderPanel({ disableUser: async () => { throw new Error("service unavailable"); } });
    const opener = within(linkedRow()).getByTestId("btn_disable_account");
    await user.click(opener);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByTestId("disable_note"), "Employment ended");
    await user.click(within(dialog).getByTestId("btn_confirm_disable"));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("No pudimos completar la acción. Revisa los datos e inténtalo de nuevo.");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect((within(dialog).getByTestId("btn_confirm_disable") as HTMLButtonElement).disabled).toBe(false);
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  test("settles every server action with its exact form context and success feedback", async () => {
    const user = userEvent.setup();
    const calls: Array<{ readonly kind: string; readonly entries: Record<string, FormDataEntryValue> }> = [];
    const record = (kind: string) => async (formData: FormData) => {
      calls.push({ kind, entries: Object.fromEntries(formData) });
    };
    renderPanel({
      createUser: record("create"),
      disableUser: record("disable"),
      grantRole: record("grant"),
      removeRole: record("remove"),
      resetTwoFactor: record("reset"),
    });

    async function settle(opener: HTMLElement, noteId: string, submitId: string, success: string, extra?: () => unknown) {
      await user.click(opener);
      const dialog = screen.getByRole("dialog");
      if (extra) await extra();
      await user.type(within(dialog).getByTestId(noteId), "Exact audit reason");
      await user.click(within(dialog).getByTestId(submitId));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByRole("status").textContent).toBe(success);
    }

    await settle(
      screen.getByTestId("btn_new_account"),
      "account_note",
      "btn_create_account",
      labels.createSuccess,
      async () => {
        await user.type(screen.getByTestId("display_name"), "New User");
        await user.type(screen.getByTestId("email"), "new@example.com");
      },
    );
    await settle(within(linkedRow()).getByTestId("btn_reset_2fa"), "reset_note", "btn_confirm_reset_2fa", labels.resetSuccess);
    await settle(within(linkedRow()).getByTestId("btn_disable_account"), "disable_note", "btn_confirm_disable", labels.disableSuccess);
    await user.click(screen.getByTestId("tab_roles"));
    await settle(screen.getByTestId("btn_add_role"), "grant_note", "btn_confirm_add_role", labels.addRoleSuccess);
    await settle(screen.getByTestId("btn_remove_role"), "remove_note", "btn_confirm_remove_role", labels.removeRoleSuccess);

    expect(calls).toEqual([
      { kind: "create", entries: { displayName: "New User", email: "new@example.com", personId: "", globalRole: "", note: "Exact audit reason" } },
      { kind: "reset", entries: { userAccountId: linkedUserId, note: "Exact audit reason" } },
      { kind: "disable", entries: { userAccountId: linkedUserId, note: "Exact audit reason" } },
      { kind: "grant", entries: { userAccountId: linkedUserId, companyId, role: "approver", validFrom: "", validTo: "", note: "Exact audit reason" } },
      { kind: "remove", entries: { roleAssignmentId: grantId, note: "Exact audit reason" } },
    ]);
    expect(navigation.refresh).toHaveBeenCalledTimes(5);
  });

  test("renders each specified modal control only in its interactive context (kills scaffold/missing-control mutants)", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByTestId("users_roles_action_bar")).toBeTruthy();
    expect(screen.getByTestId("tabs_users_roles")).toBeTruthy();
    expect(screen.getByTestId("users_table")).toBeTruthy();
    expect(screen.getByText(labels.twoFactorConfigured)).toBeTruthy();
    expect(screen.getByTestId("btn_view_person")).toBeTruthy();
    expect(screen.getAllByTestId("btn_reset_2fa")).toHaveLength(2);
    expect(screen.getAllByTestId("btn_disable_account")).toHaveLength(2);

    await user.click(screen.getByTestId("btn_new_account"));
    let dialog = screen.getByTestId("modal_new_account");
    for (const id of ["display_name", "email", "person_id", "global_role", "account_note", "btn_create_account", "btn_cancel_new_account"]) {
      expect(within(dialog).getByTestId(id)).toBeTruthy();
    }
    await user.click(within(dialog).getByTestId("btn_cancel_new_account"));

    await user.click(within(linkedRow()).getByTestId("btn_reset_2fa"));
    dialog = screen.getByTestId("modal_reset_2fa");
    for (const id of ["reset_note", "btn_confirm_reset_2fa", "btn_cancel_reset_2fa"]) {
      expect(within(dialog).getByTestId(id)).toBeTruthy();
    }
    await user.click(within(dialog).getByTestId("btn_cancel_reset_2fa"));

    await user.click(within(linkedRow()).getByTestId("btn_disable_account"));
    dialog = screen.getByTestId("modal_disable_account");
    for (const id of ["disable_note", "btn_confirm_disable", "btn_cancel_disable"]) {
      expect(within(dialog).getByTestId(id)).toBeTruthy();
    }
    await user.click(within(dialog).getByTestId("btn_cancel_disable"));

    await user.click(screen.getByTestId("tab_roles"));
    expect(screen.getByTestId("roles_table")).toBeTruthy();
    expect(screen.getByTestId("btn_remove_role")).toBeTruthy();
    await user.click(screen.getByTestId("btn_add_role"));
    dialog = screen.getByTestId("modal_add_role");
    for (const id of ["user_account_id", "company_id", "role", "valid_from", "valid_to", "grant_note", "btn_confirm_add_role", "btn_cancel_add_role"]) {
      expect(within(dialog).getByTestId(id)).toBeTruthy();
    }
    await user.click(within(dialog).getByTestId("btn_cancel_add_role"));
    await user.click(screen.getByTestId("btn_remove_role"));
    dialog = screen.getByTestId("modal_remove_role");
    for (const id of ["remove_note", "btn_confirm_remove_role", "btn_cancel_remove_role"]) {
      expect(within(dialog).getByTestId(id)).toBeTruthy();
    }
    expect(within(dialog).queryByLabelText(/password|contrase(?:ñ|n)a|totp secret/i)).toBeNull();
  });

  test("requires the visible note field in every privileged modal (kills optional-note mutant)", async () => {
    const user = userEvent.setup();
    renderPanel();
    const assertRequired = async (opener: HTMLElement, noteId: string, cancelId: string) => {
      await user.click(opener);
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByTestId(noteId).hasAttribute("required")).toBe(true);
      await user.click(within(dialog).getByTestId(cancelId));
    };
    await assertRequired(screen.getByTestId("btn_new_account"), "account_note", "btn_cancel_new_account");
    await assertRequired(within(linkedRow()).getByTestId("btn_reset_2fa"), "reset_note", "btn_cancel_reset_2fa");
    await assertRequired(within(linkedRow()).getByTestId("btn_disable_account"), "disable_note", "btn_cancel_disable");
    await user.click(screen.getByTestId("tab_roles"));
    await assertRequired(screen.getByTestId("btn_add_role"), "grant_note", "btn_cancel_add_role");
    await assertRequired(screen.getByTestId("btn_remove_role"), "remove_note", "btn_cancel_remove_role");
  });

  test("renders exact role, state, date, option, empty, and hidden-scope values (kills display-branch mutants)", async () => {
    const user = userEvent.setup();
    const noOp = async (_formData: FormData) => undefined;
    const labels = esMessages.usersRoles as UsersRolesLabels;
    const { rerender } = render(
      <UsersRolesPanel
        actions={{ createUser: noOp, disableUser: noOp, resetTwoFactor: noOp, grantRole: noOp, removeRole: noOp }}
        companies={[{ id: "company-a", name: "Company A" }]}
        grants={[
          { id: "grant-a", userAccountId: "user-a", userEmail: "admin@example.com", companyId: "company-a", companyName: "Company A", role: "approver", validFrom: "2026-08-03", validTo: null },
          { id: "grant-b", userAccountId: "user-b", userEmail: "finance@example.com", companyId: "company-a", companyName: "Company A", role: "finance", validFrom: null, validTo: "2027-01-01" },
          { id: "grant-c", userAccountId: "user-c", userEmail: "viewer@example.com", companyId: "company-a", companyName: "Company A", role: "viewer", validFrom: null, validTo: null },
        ]}
        labels={labels}
        locale="es-EC"
        people={[{ id: "person-a", fullName: "Available Person" }]}
        users={[
          { id: "user-a", email: "admin@example.com", globalRole: "group_admin", idpSubject: "kc-a", lastLoginAt: "2026-08-03T12:00:00.000Z", linkedPerson: "Admin Person", personId: "person-a", companyId: "company-a", status: "active", twoFactorStatus: "configured" },
          { id: "user-b", email: "finance@example.com", globalRole: "central_finance", idpSubject: "kc-b", lastLoginAt: null, linkedPerson: null, personId: null, companyId: null, status: "disabled", twoFactorStatus: "pending" },
          { id: "user-c", email: "viewer@example.com", globalRole: null, idpSubject: "kc-c", lastLoginAt: null, linkedPerson: null, personId: null, companyId: null, status: "active", twoFactorStatus: "pending" },
        ]}
      />,
    );
    const usersTable = within(screen.getByTestId("users_table"));
    expect(usersTable.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      labels.email,
      labels.globalRole,
      labels.linkedPerson,
      labels.twoFactor,
      labels.status,
      labels.lastLogin,
      labels.actionsHeader,
    ]);
    const userRows = usersTable.getAllByRole("row").slice(1);
    expect(userRows).toHaveLength(3);
    expect(within(userRows[0]!).getAllByRole("cell").slice(0, 6).map((cell) => cell.textContent)).toEqual([
      "admin@example.com",
      labels.groupAdmin,
      "Admin Person",
      labels.twoFactorConfigured,
      labels.active,
      new Intl.DateTimeFormat("es-EC", { dateStyle: "medium" }).format(new Date("2026-08-03T12:00:00.000Z")),
    ]);
    expect(within(userRows[1]!).getAllByRole("cell").slice(0, 6).map((cell) => cell.textContent)).toEqual([
      "finance@example.com",
      labels.centralFinance,
      labels.none,
      labels.twoFactorPending,
      labels.disabled,
      labels.none,
    ]);
    expect(within(userRows[2]!).getAllByRole("cell").slice(0, 6).map((cell) => cell.textContent)).toEqual([
      "viewer@example.com",
      labels.noGlobalRole,
      labels.none,
      labels.twoFactorPending,
      labels.active,
      labels.none,
    ]);

    expect(screen.getByTestId("btn_new_account").className).toContain("bg-primary");
    expect(screen.getAllByTestId("btn_view_person")[0]?.className).toContain("hover:bg-surface-muted");
    await user.click(screen.getByTestId("btn_new_account"));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("email").className).toContain("focus:ring-primary");
    expect([...((within(dialog).getByTestId("person_id") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([
      ["", labels.none],
      ["person-a", "Available Person"],
    ]);
    expect([...((within(dialog).getByTestId("global_role") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([
      ["", labels.noGlobalRole],
      ["group_admin", labels.groupAdmin],
      ["central_finance", labels.centralFinance],
    ]);
    await user.click(within(dialog).getByTestId("btn_cancel_new_account"));

    const resetIds: string[] = [];
    for (const row of userRows) {
      await user.click(within(row).getByTestId("btn_reset_2fa"));
      dialog = screen.getByRole("dialog");
      resetIds.push((dialog.querySelector('input[name="userAccountId"]') as HTMLInputElement).value);
      await user.click(within(dialog).getByTestId("btn_cancel_reset_2fa"));
      await user.click(within(row).getByTestId("btn_disable_account"));
      dialog = screen.getByRole("dialog");
      expect(dialog.querySelector('input[name="companyId"]')).toBeNull();
      await user.click(within(dialog).getByTestId("btn_cancel_disable"));
    }
    expect(resetIds).toEqual(["user-a", "user-b", "user-c"]);

    await user.click(screen.getByTestId("tab_roles"));
    const rolesTable = within(screen.getByTestId("roles_table"));
    expect(rolesTable.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      labels.user,
      labels.company,
      labels.role,
      labels.validFrom,
      labels.validTo,
      labels.actionsHeader,
    ]);
    expect(rolesTable.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").slice(0, 5).map((cell) => cell.textContent))).toEqual([
      ["admin@example.com", "Company A", labels.approver, "2026-08-03", labels.none],
      ["finance@example.com", "Company A", labels.finance, labels.none, "2027-01-01"],
      ["viewer@example.com", "Company A", labels.viewer, labels.none, labels.none],
    ]);
    await user.click(screen.getByTestId("btn_add_role"));
    dialog = screen.getByRole("dialog");
    expect([...((within(dialog).getByTestId("user_account_id") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([
      ["user-a", "admin@example.com"],
      ["user-b", "finance@example.com"],
      ["user-c", "viewer@example.com"],
    ]);
    expect([...((within(dialog).getByTestId("company_id") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([["company-a", "Company A"]]);
    expect([...((within(dialog).getByTestId("role") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([
      ["approver", labels.approver],
      ["finance", labels.finance],
      ["viewer", labels.viewer],
    ]);
    await user.click(within(dialog).getByTestId("btn_cancel_add_role"));
    const assignmentIds: string[] = [];
    for (const button of rolesTable.getAllByTestId("btn_remove_role")) {
      await user.click(button);
      dialog = screen.getByRole("dialog");
      assignmentIds.push((dialog.querySelector('input[name="roleAssignmentId"]') as HTMLInputElement).value);
      expect(dialog.querySelector('input[name="companyId"]')).toBeNull();
      await user.click(within(dialog).getByTestId("btn_cancel_remove_role"));
    }
    expect(assignmentIds).toEqual(["grant-a", "grant-b", "grant-c"]);

    rerender(<UsersRolesPanel actions={{ createUser: noOp, disableUser: noOp, resetTwoFactor: noOp, grantRole: noOp, removeRole: noOp }} companies={[]} grants={[]} labels={labels} locale="es-EC" users={[]} />);
    expect(within(screen.getByTestId("roles_table")).getAllByRole("row")).toHaveLength(2);
    expect(within(screen.getByTestId("roles_table")).getByRole("cell").textContent).toBe(labels.emptyRoles);
    await user.click(screen.getByTestId("tab_usuarios"));
    expect(within(screen.getByTestId("users_table")).getAllByRole("row")).toHaveLength(2);
    expect(within(screen.getByTestId("users_table")).getByRole("cell").textContent).toBe(labels.emptyUsers);
    await user.click(screen.getByTestId("btn_new_account"));
    dialog = screen.getByRole("dialog");
    expect((within(dialog).getByTestId("person_id") as HTMLSelectElement).options).toHaveLength(1);
    await user.click(within(dialog).getByTestId("btn_cancel_new_account"));
    await user.click(screen.getByTestId("tab_roles"));
    await user.click(screen.getByTestId("btn_add_role"));
    dialog = screen.getByRole("dialog");
    expect((within(dialog).getByTestId("user_account_id") as HTMLSelectElement).options).toHaveLength(0);
    expect((within(dialog).getByTestId("company_id") as HTMLSelectElement).options).toHaveLength(0);
  });
});
