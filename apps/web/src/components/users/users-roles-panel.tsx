"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { ROUTE_SCR_PERSON_DETAIL } from "@/lib/routes";
import type { createUserAccount as CreateUserAccountAction } from "@/modules/identity-access/actions/manage-users";

export interface UsersRolesLabels {
  readonly actionsHeader: string;
  readonly title: string;
  readonly subtitle: string;
  readonly usersTab: string;
  readonly rolesTab: string;
  readonly usersTitle: string;
  readonly usersDescription: string;
  readonly rolesTitle: string;
  readonly rolesDescription: string;
  readonly newAccount: string;
  readonly addRole: string;
  readonly email: string;
  readonly globalRole: string;
  readonly linkedPerson: string;
  readonly twoFactor: string;
  readonly status: string;
  readonly lastLogin: string;
  readonly user: string;
  readonly company: string;
  readonly role: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly viewPerson: string;
  readonly resetTwoFactor: string;
  readonly disable: string;
  readonly removeRole: string;
  readonly active: string;
  readonly disabled: string;
  readonly twoFactorConfigured: string;
  readonly twoFactorPending: string;
  readonly none: string;
  readonly emptyUsers: string;
  readonly emptyRoles: string;
  readonly createAccount: string;
  readonly resetTitle: string;
  readonly disableTitle: string;
  readonly addRoleTitle: string;
  readonly removeRoleTitle: string;
  readonly person: string;
  readonly accountNote: string;
  readonly resetNote: string;
  readonly disableNote: string;
  readonly grantNote: string;
  readonly removeNote: string;
  readonly groupAdmin: string;
  readonly centralFinance: string;
  readonly noGlobalRole: string;
  readonly approver: string;
  readonly finance: string;
  readonly viewer: string;
  readonly cancel: string;
  readonly confirmReset: string;
  readonly confirmDisable: string;
  readonly confirmAddRole: string;
  readonly confirmRemoveRole: string;
  readonly accountDescription: string;
  readonly addRoleDescription: string;
  readonly addRoleSuccess: string;
  readonly createSuccess: string;
  readonly delegationHelp: string;
  readonly disableDescription: string;
  readonly disablePlaceholder: string;
  readonly disableSuccess: string;
  readonly emailPlaceholder: string;
  readonly error: string;
  readonly globalRoleHelp: string;
  readonly globalRoleOptional: string;
  readonly personHelp: string;
  readonly removeDescription: string;
  readonly removePlaceholder: string;
  readonly removeRoleSuccess: string;
  readonly resetDescription: string;
  readonly resetPlaceholder: string;
  readonly resetSuccess: string;
  readonly submitting: string;
  readonly userHelp: string;
  readonly validFromOptional: string;
  readonly validToOptional: string;
}

type Action = typeof CreateUserAccountAction;

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly globalRole: "group_admin" | "central_finance" | null;
  readonly idpSubject: string;
  readonly lastLoginAt: Date | string | null;
  readonly linkedPerson: string | null;
  readonly personId: string | null;
  readonly companyId: string | null;
  readonly status: "active" | "disabled";
  readonly twoFactorStatus: "configured" | "pending";
}

interface GrantRow {
  readonly id: string;
  readonly userAccountId: string;
  readonly userEmail: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly role: "approver" | "finance" | "viewer";
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

type DialogState =
  | { readonly kind: "new_account"; readonly opener: HTMLButtonElement }
  | { readonly kind: "reset_2fa"; readonly opener: HTMLButtonElement; readonly user: UserRow }
  | { readonly kind: "disable_account"; readonly opener: HTMLButtonElement; readonly user: UserRow }
  | { readonly kind: "add_role"; readonly opener: HTMLButtonElement }
  | { readonly kind: "remove_role"; readonly opener: HTMLButtonElement; readonly grant: GrantRow };

type DialogInput = DialogState extends infer State
  ? State extends { readonly opener: HTMLButtonElement }
    ? Omit<State, "opener">
    : never
  : never;

const fieldClass = "min-h-11 w-full rounded border border-border bg-surface px-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary";
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded bg-primary px-4 font-medium text-on-primary disabled:cursor-not-allowed disabled:opacity-50";
const quietClass = "inline-flex min-h-11 items-center rounded px-3 text-primary hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50";
const dialogClass = "max-h-[90vh] w-[min(36rem,calc(100%-2rem))] rounded border border-border bg-surface p-5 text-text-primary backdrop:bg-overlay";

function openNativeDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeNativeDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function trapDialogFocus(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    "input:not([type='hidden']),select,textarea,button:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])",
  ));
  if (controls.length < 2) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  if (
    (!event.shiftKey && current === controls.length - 1) ||
    (event.shiftKey && current <= 0)
  ) {
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
  }
}

function NoteField({
  id,
  label,
  placeholder,
}: {
  readonly id: string;
  readonly label: string;
  readonly placeholder?: string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <textarea
        className={fieldClass}
        data-testid={id}
        name="note"
        placeholder={placeholder}
        required
      />
    </label>
  );
}

function Help({ id, children }: { readonly id: string; readonly children: string }) {
  return <span className="block text-xs text-text-secondary" id={id}>{children}</span>;
}

export function UsersRolesPanel({
  actions,
  companies,
  grants,
  labels,
  locale,
  people,
  users,
}: {
  readonly actions: {
    readonly createUser: Action;
    readonly disableUser: Action;
    readonly resetTwoFactor: Action;
    readonly grantRole: Action;
    readonly removeRole: Action;
  };
  readonly companies: readonly { readonly id: string; readonly name: string }[];
  readonly grants: readonly GrantRow[];
  readonly labels: UsersRolesLabels;
  readonly locale: string;
  readonly people?: readonly { readonly id: string; readonly fullName: string }[];
  readonly users: readonly UserRow[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);
  const [selectedTab, setSelectedTab] = useState<"users" | "roles">("users");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!dialog) return;
    openNativeDialog(dialogRef.current);
    dialogRef.current
      ?.querySelector<HTMLElement>("input:not([type='hidden']),select,textarea,button")
      ?.focus();
  }, [dialog]);

  const date = (value: Date | string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value))
      : labels.none;
  const roleLabel = (role: UserRow["globalRole"] | GrantRow["role"]) =>
    role === "group_admin"
      ? labels.groupAdmin
      : role === "central_finance"
        ? labels.centralFinance
        : role === "approver"
          ? labels.approver
          : role === "finance"
            ? labels.finance
            : role === "viewer"
              ? labels.viewer
              : labels.noGlobalRole;

  function show(next: DialogInput, opener: HTMLButtonElement) {
    setError(null);
    setFeedback(null);
    setDialog({ ...next, opener } as DialogState);
  }

  function dismiss() {
    if (!dialog || pendingRef.current) return;
    const opener = dialog.opener;
    closeNativeDialog(dialogRef.current);
    setError(null);
    setDialog(null);
    queueMicrotask(() => opener.focus());
  }

  function settlement(current: DialogState): { readonly action: Action; readonly success: string } {
    if (current.kind === "new_account") return { action: actions.createUser, success: labels.createSuccess };
    if (current.kind === "reset_2fa") return { action: actions.resetTwoFactor, success: labels.resetSuccess };
    if (current.kind === "disable_account") return { action: actions.disableUser, success: labels.disableSuccess };
    if (current.kind === "add_role") return { action: actions.grantRole, success: labels.addRoleSuccess };
    return { action: actions.removeRole, success: labels.removeRoleSuccess };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || pendingRef.current) return;
    const current = dialog;
    const formData = new FormData(event.currentTarget);
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const next = settlement(current);
      await next.action(formData);
      setFeedback(next.success);
      closeNativeDialog(dialogRef.current);
      setDialog(null);
      queueMicrotask(() => current.opener.focus());
      router.refresh();
    } catch {
      setError(labels.error);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const dialogTitle =
    dialog?.kind === "new_account"
      ? labels.createAccount
      : dialog?.kind === "reset_2fa"
        ? labels.resetTitle
        : dialog?.kind === "disable_account"
          ? labels.disableTitle
          : dialog?.kind === "add_role"
            ? labels.addRoleTitle
            : labels.removeRoleTitle;
  const dialogDescription =
    dialog?.kind === "new_account"
      ? labels.accountDescription
      : dialog?.kind === "reset_2fa"
        ? labels.resetDescription
        : dialog?.kind === "disable_account"
          ? labels.disableDescription
          : dialog?.kind === "add_role"
            ? labels.addRoleDescription
            : labels.removeDescription;

  return (
    <div className="space-y-5">
      <section className="flex justify-end" data-testid="users_roles_action_bar">
        <button
          className={buttonClass}
          data-testid="btn_new_account"
          onClick={(event) => show({ kind: "new_account" }, event.currentTarget)}
          type="button"
        >
          {labels.newAccount}
        </button>
      </section>

      <section className="space-y-4" data-testid="tabs_users_roles">
        <div aria-label={labels.title} className="flex gap-2 border-b border-border" role="tablist">
          <button
            aria-controls="panel_usuarios"
            aria-selected={selectedTab === "users"}
            className={quietClass}
            data-testid="tab_usuarios"
            id="tab_usuarios_control"
            onClick={() => setSelectedTab("users")}
            role="tab"
            type="button"
          >
            {labels.usersTab} ({users.length})
          </button>
          <button
            aria-controls="panel_roles"
            aria-selected={selectedTab === "roles"}
            className={quietClass}
            data-testid="tab_roles"
            id="tab_roles_control"
            onClick={() => setSelectedTab("roles")}
            role="tab"
            type="button"
          >
            {labels.rolesTab} ({grants.length})
          </button>
        </div>

        {selectedTab === "users" ? (
          <section aria-labelledby="tab_usuarios_control" id="panel_usuarios" role="tabpanel">
            <div className="overflow-x-auto rounded border border-border bg-surface" data-testid="users_table">
              <div className="p-4">
                <h2 className="font-display text-2xl">{labels.usersTitle}</h2>
                <p className="text-sm text-text-secondary">{labels.usersDescription}</p>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {[labels.email, labels.globalRole, labels.linkedPerson, labels.twoFactor, labels.status, labels.lastLogin].map((heading) => (
                      <th className="border-t border-border p-3" key={heading}>{heading}</th>
                    ))}
                    <th className="border-t border-border p-3"><span className="sr-only">{labels.actionsHeader}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td className="p-4 text-text-muted" colSpan={7}>{labels.emptyUsers}</td></tr>
                  ) : users.map((user) => (
                    <tr key={user.id}>
                      <td className="border-t border-border p-3">{user.email}</td>
                      <td className="border-t border-border p-3">{roleLabel(user.globalRole)}</td>
                      <td className="border-t border-border p-3">{user.linkedPerson ?? labels.none}</td>
                      <td className="border-t border-border p-3">{user.twoFactorStatus === "configured" ? labels.twoFactorConfigured : labels.twoFactorPending}</td>
                      <td className="border-t border-border p-3">{user.status === "active" ? labels.active : labels.disabled}</td>
                      <td className="border-t border-border p-3">{date(user.lastLoginAt)}</td>
                      <td className="border-t border-border p-3">
                        <div className="flex flex-wrap gap-1">
                          {user.personId ? (
                            <Link
                              className={quietClass}
                              data-testid="btn_view_person"
                              href={ROUTE_SCR_PERSON_DETAIL.replace(":personId", user.personId)}
                            >
                              {labels.viewPerson}
                            </Link>
                          ) : null}
                          <button
                            className={quietClass}
                            data-testid="btn_reset_2fa"
                            onClick={(event) => show({ kind: "reset_2fa", user }, event.currentTarget)}
                            type="button"
                          >
                            {labels.resetTwoFactor}
                          </button>
                          <button
                            className={quietClass}
                            data-testid="btn_disable_account"
                            onClick={(event) => show({ kind: "disable_account", user }, event.currentTarget)}
                            type="button"
                          >
                            {labels.disable}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section aria-labelledby="tab_roles_control" id="panel_roles" role="tabpanel">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="font-display text-2xl">{labels.rolesTitle}</h2>
                <p className="text-sm text-text-secondary">{labels.rolesDescription}</p>
              </div>
              <button
                className={buttonClass}
                data-testid="btn_add_role"
                onClick={(event) => show({ kind: "add_role" }, event.currentTarget)}
                type="button"
              >
                {labels.addRole}
              </button>
            </div>
            <div className="overflow-x-auto rounded border border-border bg-surface" data-testid="roles_table">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {[labels.user, labels.company, labels.role, labels.validFrom, labels.validTo].map((heading) => (
                      <th className="border-t border-border p-3" key={heading}>{heading}</th>
                    ))}
                    <th className="border-t border-border p-3"><span className="sr-only">{labels.actionsHeader}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {grants.length === 0 ? (
                    <tr><td className="p-4 text-text-muted" colSpan={6}>{labels.emptyRoles}</td></tr>
                  ) : grants.map((grant) => (
                    <tr key={grant.id}>
                      <td className="border-t border-border p-3">{grant.userEmail}</td>
                      <td className="border-t border-border p-3">{grant.companyName}</td>
                      <td className="border-t border-border p-3">{roleLabel(grant.role)}</td>
                      <td className="border-t border-border p-3">{grant.validFrom ?? labels.none}</td>
                      <td className="border-t border-border p-3">{grant.validTo ?? labels.none}</td>
                      <td className="border-t border-border p-3">
                        <button
                          className={quietClass}
                          data-testid="btn_remove_role"
                          onClick={(event) => show({ kind: "remove_role", grant }, event.currentTarget)}
                          type="button"
                        >
                          {labels.removeRole}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>

      {dialog ? (
        <dialog
          aria-describedby="users-roles-dialog-description"
          aria-labelledby="users-roles-dialog-title"
          className={dialogClass}
          data-testid={
            dialog.kind === "new_account"
              ? "modal_new_account"
              : dialog.kind === "reset_2fa"
                ? "modal_reset_2fa"
                : dialog.kind === "disable_account"
                  ? "modal_disable_account"
                  : dialog.kind === "add_role"
                    ? "modal_add_role"
                    : "modal_remove_role"
          }
          onCancel={(event) => {
            event.preventDefault();
            dismiss();
          }}
          onKeyDown={trapDialogFocus}
          ref={dialogRef}
        >
          <h2 className="font-display text-xl" id="users-roles-dialog-title">{dialogTitle}</h2>
          <p className="mt-2 text-sm text-text-secondary" id="users-roles-dialog-description">{dialogDescription}</p>
          {"user" in dialog ? <p className="mt-3 font-medium">{dialog.user.email}</p> : null}
          {"grant" in dialog ? (
            <p className="mt-3 font-medium">{dialog.grant.userEmail} · {dialog.grant.companyName} · {roleLabel(dialog.grant.role)}</p>
          ) : null}
          <form className="mt-4 space-y-3" onSubmit={submit}>
            {dialog.kind === "new_account" ? (
              <>
                <label className="block space-y-1 text-sm">
                  <span>{labels.email}</span>
                  <input className={fieldClass} data-testid="email" name="email" placeholder={labels.emailPlaceholder} required type="email" />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>{labels.person}</span>
                  <select aria-describedby="person-help" className={fieldClass} data-testid="person_id" name="personId">
                    <option value="">{labels.none}</option>
                    {(people ?? []).map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
                  </select>
                  <Help id="person-help">{labels.personHelp}</Help>
                </label>
                <label className="block space-y-1 text-sm">
                  <span>{labels.globalRoleOptional}</span>
                  <select aria-describedby="global-role-help" className={fieldClass} data-testid="global_role" name="globalRole">
                    <option value="">{labels.noGlobalRole}</option>
                    <option value="group_admin">{labels.groupAdmin}</option>
                    <option value="central_finance">{labels.centralFinance}</option>
                  </select>
                  <Help id="global-role-help">{labels.globalRoleHelp}</Help>
                </label>
                <NoteField id="account_note" label={labels.accountNote} />
              </>
            ) : null}

            {dialog.kind === "reset_2fa" ? (
              <>
                <input name="userAccountId" type="hidden" value={dialog.user.id} />
                <NoteField id="reset_note" label={labels.resetNote} placeholder={labels.resetPlaceholder} />
              </>
            ) : null}

            {dialog.kind === "disable_account" ? (
              <>
                <input name="userAccountId" type="hidden" value={dialog.user.id} />
                <input name="companyId" type="hidden" value={dialog.user.companyId ?? ""} />
                <NoteField id="disable_note" label={labels.disableNote} placeholder={labels.disablePlaceholder} />
              </>
            ) : null}

            {dialog.kind === "add_role" ? (
              <>
                <label className="block space-y-1 text-sm">
                  <span>{labels.user}</span>
                  <select aria-describedby="user-help" className={fieldClass} data-testid="user_account_id" name="userAccountId" required>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
                  </select>
                  <Help id="user-help">{labels.userHelp}</Help>
                </label>
                <label className="block space-y-1 text-sm">
                  <span>{labels.company}</span>
                  <select className={fieldClass} data-testid="company_id" name="companyId" required>
                    {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span>{labels.role}</span>
                  <select className={fieldClass} data-testid="role" name="role" required>
                    <option value="approver">{labels.approver}</option>
                    <option value="finance">{labels.finance}</option>
                    <option value="viewer">{labels.viewer}</option>
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span>{labels.validFromOptional}</span>
                  <input className={fieldClass} data-testid="valid_from" name="validFrom" type="date" />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>{labels.validToOptional}</span>
                  <input aria-describedby="delegation-help" className={fieldClass} data-testid="valid_to" name="validTo" type="date" />
                  <Help id="delegation-help">{labels.delegationHelp}</Help>
                </label>
                <NoteField id="grant_note" label={labels.grantNote} />
              </>
            ) : null}

            {dialog.kind === "remove_role" ? (
              <>
                <input name="assignmentId" type="hidden" value={dialog.grant.id} />
                <input name="companyId" type="hidden" value={dialog.grant.companyId} />
                <NoteField id="remove_note" label={labels.removeNote} placeholder={labels.removePlaceholder} />
              </>
            ) : null}

            {error ? <p className="text-sm text-error-text" role="alert">{error}</p> : null}
            <div className="flex justify-end gap-3">
              <button
                className={quietClass}
                data-testid={
                  dialog.kind === "new_account"
                    ? "btn_cancel_new_account"
                    : dialog.kind === "reset_2fa"
                      ? "btn_cancel_reset_2fa"
                      : dialog.kind === "disable_account"
                        ? "btn_cancel_disable"
                        : dialog.kind === "add_role"
                          ? "btn_cancel_add_role"
                          : "btn_cancel_remove_role"
                }
                disabled={pending}
                onClick={dismiss}
                type="button"
              >
                {labels.cancel}
              </button>
              <button
                className={buttonClass}
                data-testid={
                  dialog.kind === "new_account"
                    ? "btn_create_account"
                    : dialog.kind === "reset_2fa"
                      ? "btn_confirm_reset_2fa"
                      : dialog.kind === "disable_account"
                        ? "btn_confirm_disable"
                        : dialog.kind === "add_role"
                          ? "btn_confirm_add_role"
                          : "btn_confirm_remove_role"
                }
                disabled={pending}
                type="submit"
              >
                {pending
                  ? labels.submitting
                  : dialog.kind === "new_account"
                    ? labels.createAccount
                    : dialog.kind === "reset_2fa"
                      ? labels.confirmReset
                      : dialog.kind === "disable_account"
                        ? labels.confirmDisable
                        : dialog.kind === "add_role"
                          ? labels.confirmAddRole
                          : labels.confirmRemoveRole}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}

      <div aria-live="polite" role="status">
        {feedback ? <p className="text-success">{feedback}</p> : null}
      </div>
    </div>
  );
}
