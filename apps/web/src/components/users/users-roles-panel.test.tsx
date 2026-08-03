// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import esMessages from "../../../messages/es-EC.json";
import {
  UsersRolesPanel,
  type UsersRolesLabels,
} from "./users-roles-panel";

afterEach(cleanup);

describe("SCR-users-roles", () => {
  test("renders every specified section, action, field, and Keycloak-derived 2FA state (kills scaffold/missing-control mutants)", () => {
    const noOp = async (_formData: FormData) => undefined;
    render(
      <UsersRolesPanel
        actions={{ createUser: noOp, disableUser: noOp, resetTwoFactor: noOp, grantRole: noOp, removeRole: noOp }}
        companies={[{ id: "company-a", name: "Company A" }]}
        grants={[{ id: "grant-a", userAccountId: "user-a", userEmail: "user@example.com", companyId: "company-a", companyName: "Company A", role: "approver", validFrom: "2026-08-03", validTo: null }]}
        labels={esMessages.usersRoles as UsersRolesLabels}
        locale="es-EC"
        users={[{ id: "user-a", email: "user@example.com", globalRole: null, idpSubject: "kc-a", lastLoginAt: null, linkedPerson: "Usuario Ejemplo", companyId: "company-a", status: "active", twoFactorStatus: "configured" }]}
      />,
    );

    for (const id of [
      "users_roles_action_bar", "tabs_users_roles", "tab_usuarios", "users_table",
      "tab_roles", "roles_table", "btn_new_account", "btn_add_role",
      "btn_view_person", "btn_reset_2fa", "btn_disable_account", "btn_remove_role",
      "modal_new_account", "email", "person_id", "global_role", "btn_create_account",
      "btn_cancel_new_account", "modal_reset_2fa", "reset_note", "btn_confirm_reset_2fa",
      "btn_cancel_reset_2fa", "modal_disable_account", "disable_note", "btn_confirm_disable",
      "btn_cancel_disable", "modal_add_role", "user_account_id", "company_id", "role",
      "valid_from", "valid_to", "btn_confirm_add_role", "btn_cancel_add_role",
      "modal_remove_role", "remove_note", "btn_confirm_remove_role", "btn_cancel_remove_role",
    ]) {
      expect(screen.getAllByTestId(id).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(esMessages.usersRoles.twoFactorConfigured)).toBeTruthy();
    expect(screen.queryByLabelText(/password|contrase(?:ñ|n)a|totp secret/i)).toBeNull();
  });

  test("requires a visible note field for every privileged mutation (kills optional-note mutant)", () => {
    const noOp = async (_formData: FormData) => undefined;
    render(
      <UsersRolesPanel actions={{ createUser: noOp, disableUser: noOp, resetTwoFactor: noOp, grantRole: noOp, removeRole: noOp }} companies={[{ id: "company-a", name: "Company A" }]} grants={[{ id: "grant-a", userAccountId: "user-a", userEmail: "user@example.com", companyId: "company-a", companyName: "Company A", role: "viewer", validFrom: null, validTo: null }]} labels={esMessages.usersRoles as UsersRolesLabels} locale="es-EC" users={[{ id: "user-a", email: "user@example.com", globalRole: null, idpSubject: "kc-a", lastLoginAt: null, linkedPerson: null, companyId: "company-a", status: "active", twoFactorStatus: "pending" }]} />,
    );
    for (const id of ["account_note", "reset_note", "disable_note", "grant_note", "remove_note"]) {
      expect(screen.getByTestId(id).hasAttribute("required")).toBe(true);
    }
  });

  test("renders exact role, state, date, option, empty, and hidden-scope values (kills display-branch mutants)", () => {
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
          { id: "user-a", email: "admin@example.com", globalRole: "group_admin", idpSubject: "kc-a", lastLoginAt: "2026-08-03T12:00:00.000Z", linkedPerson: "Admin Person", companyId: "company-a", status: "active", twoFactorStatus: "configured" },
          { id: "user-b", email: "finance@example.com", globalRole: "central_finance", idpSubject: "kc-b", lastLoginAt: null, linkedPerson: null, companyId: null, status: "disabled", twoFactorStatus: "pending" },
          { id: "user-c", email: "viewer@example.com", globalRole: null, idpSubject: "kc-c", lastLoginAt: null, linkedPerson: null, companyId: null, status: "active", twoFactorStatus: "pending" },
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
    expect(screen.getByTestId("email").className).toContain("focus:ring-primary");
    expect(screen.getByTestId("btn_new_account").className).toContain("bg-primary");
    expect(screen.getAllByTestId("btn_view_person")[0]?.className).toContain("hover:bg-surface-muted");
    expect([...((screen.getByTestId("person_id") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([
      ["", labels.none],
      ["person-a", "Available Person"],
    ]);
    expect([...((screen.getByTestId("global_role") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([
      ["", labels.noGlobalRole],
      ["group_admin", labels.groupAdmin],
      ["central_finance", labels.centralFinance],
    ]);
    expect([...((screen.getByTestId("user_account_id") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([
      ["user-a", "admin@example.com"],
      ["user-b", "finance@example.com"],
      ["user-c", "viewer@example.com"],
    ]);
    expect([...((screen.getByTestId("company_id") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([["company-a", "Company A"]]);
    expect([...((screen.getByTestId("role") as HTMLSelectElement).options)].map(({ value, text }) => [value, text])).toEqual([
      ["approver", labels.approver],
      ["finance", labels.finance],
      ["viewer", labels.viewer],
    ]);
    expect(userRows.map((row) => within(row).getByTestId("btn_reset_2fa").closest("details")?.querySelector<HTMLInputElement>('input[name="userAccountId"]')?.value)).toEqual(["user-a", "user-b", "user-c"]);
    expect(userRows.map((row) => within(row).getByTestId("btn_disable_account").closest("details")?.querySelector<HTMLInputElement>('input[name="companyId"]')?.value)).toEqual(["company-a", "", ""]);
    expect(rolesTable.getAllByTestId("btn_remove_role").map((button) => button.closest("details")?.querySelector<HTMLInputElement>('input[name="assignmentId"]')?.value)).toEqual(["grant-a", "grant-b", "grant-c"]);
    expect(rolesTable.getAllByTestId("btn_remove_role").map((button) => button.closest("details")?.querySelector<HTMLInputElement>('input[name="companyId"]')?.value)).toEqual(["company-a", "company-a", "company-a"]);

    rerender(<UsersRolesPanel actions={{ createUser: noOp, disableUser: noOp, resetTwoFactor: noOp, grantRole: noOp, removeRole: noOp }} companies={[]} grants={[]} labels={labels} locale="es-EC" users={[]} />);
    expect(within(screen.getByTestId("users_table")).getAllByRole("row")).toHaveLength(2);
    expect(within(screen.getByTestId("users_table")).getByRole("cell").textContent).toBe(labels.emptyUsers);
    expect(within(screen.getByTestId("roles_table")).getAllByRole("row")).toHaveLength(2);
    expect(within(screen.getByTestId("roles_table")).getByRole("cell").textContent).toBe(labels.emptyRoles);
    expect((screen.getByTestId("person_id") as HTMLSelectElement).options).toHaveLength(1);
    expect((screen.getByTestId("user_account_id") as HTMLSelectElement).options).toHaveLength(0);
    expect((screen.getByTestId("company_id") as HTMLSelectElement).options).toHaveLength(0);
  });
});
