// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
});
