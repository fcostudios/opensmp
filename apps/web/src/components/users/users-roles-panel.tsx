import Link from "next/link";

import { ROUTE_SCR_PEOPLE } from "@/lib/routes";

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
}

type Action = (formData: FormData) => void;

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly globalRole: "group_admin" | "central_finance" | null;
  readonly idpSubject: string;
  readonly lastLoginAt: Date | string | null;
  readonly linkedPerson: string | null;
  readonly personId?: string | null;
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

const fieldClass = "min-h-11 w-full rounded border border-border bg-surface px-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary";
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded bg-primary px-4 font-medium text-on-primary";
const quietClass = "inline-flex min-h-11 items-center rounded px-3 text-primary hover:bg-surface-muted";

function NoteField({ id, label }: { readonly id: string; readonly label: string }) {
  return <label className="block space-y-1 text-sm"><span>{label}</span><textarea className={fieldClass} data-testid={id} name="note" required /></label>;
}

export function UsersRolesPanel({ actions, companies, grants, labels, locale, people, users }: {
  readonly actions: { readonly createUser: Action; readonly disableUser: Action; readonly resetTwoFactor: Action; readonly grantRole: Action; readonly removeRole: Action };
  readonly companies: readonly { readonly id: string; readonly name: string }[];
  readonly grants: readonly GrantRow[];
  readonly labels: UsersRolesLabels;
  readonly locale: string;
  readonly people?: readonly { readonly id: string; readonly fullName: string }[];
  readonly users: readonly UserRow[];
}) {
  const date = (value: Date | string | null) => value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value)) : labels.none;
  const roleLabel = (role: UserRow["globalRole"] | GrantRow["role"]) => role === "group_admin" ? labels.groupAdmin : role === "central_finance" ? labels.centralFinance : role === "approver" ? labels.approver : role === "finance" ? labels.finance : role === "viewer" ? labels.viewer : labels.noGlobalRole;
  return (
    <div className="space-y-5">
      <section className="flex justify-end" data-testid="users_roles_action_bar">
        <details><summary className={buttonClass} data-testid="btn_new_account">{labels.newAccount}</summary>
          <div className="mt-3 rounded border border-border bg-surface p-4" data-testid="modal_new_account"><h2 className="font-display text-xl">{labels.createAccount}</h2>
            <form action={actions.createUser} className="mt-4 space-y-3">
              <label className="block space-y-1 text-sm"><span>{labels.email}</span><input className={fieldClass} data-testid="email" name="email" required type="email" /></label>
              <label className="block space-y-1 text-sm"><span>{labels.person}</span><select className={fieldClass} data-testid="person_id" name="personId"><option value="">{labels.none}</option>{(people ?? []).map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
              <label className="block space-y-1 text-sm"><span>{labels.globalRole}</span><select className={fieldClass} data-testid="global_role" name="globalRole"><option value="">{labels.noGlobalRole}</option><option value="group_admin">{labels.groupAdmin}</option><option value="central_finance">{labels.centralFinance}</option></select></label>
              <NoteField id="account_note" label={labels.accountNote} />
              <button className={buttonClass} data-testid="btn_create_account" type="submit">{labels.createAccount}</button><button className={quietClass} data-testid="btn_cancel_new_account" type="reset">{labels.cancel}</button>
            </form>
          </div>
        </details>
      </section>
      <section className="space-y-6" data-testid="tabs_users_roles">
        <section data-testid="tab_usuarios"><h2 className="font-display text-2xl">{labels.usersTab}</h2>
          <div className="overflow-x-auto rounded border border-border bg-surface" data-testid="users_table"><div className="p-4"><h3 className="font-semibold">{labels.usersTitle}</h3><p className="text-sm text-text-secondary">{labels.usersDescription}</p></div>
            <table className="w-full text-left text-sm"><thead><tr>{[labels.email, labels.globalRole, labels.linkedPerson, labels.twoFactor, labels.status, labels.lastLogin].map((heading) => <th className="border-t border-border p-3" key={heading}>{heading}</th>)}<th className="border-t border-border p-3"><span className="sr-only">{labels.actionsHeader}</span></th></tr></thead>
              <tbody>{users.length === 0 ? <tr><td className="p-4 text-text-muted" colSpan={7}>{labels.emptyUsers}</td></tr> : users.map((user) => <tr key={user.id}><td className="border-t border-border p-3">{user.email}</td><td className="border-t border-border p-3">{roleLabel(user.globalRole)}</td><td className="border-t border-border p-3">{user.linkedPerson ?? labels.none}</td><td className="border-t border-border p-3">{user.twoFactorStatus === "configured" ? labels.twoFactorConfigured : labels.twoFactorPending}</td><td className="border-t border-border p-3">{user.status === "active" ? labels.active : labels.disabled}</td><td className="border-t border-border p-3">{date(user.lastLoginAt)}</td><td className="border-t border-border p-3"><Link className={quietClass} data-testid="btn_view_person" href={ROUTE_SCR_PEOPLE}>{labels.viewPerson}</Link>
                <details><summary className={quietClass} data-testid="btn_reset_2fa">{labels.resetTwoFactor}</summary><div data-testid="modal_reset_2fa"><h3>{labels.resetTitle}</h3><form action={actions.resetTwoFactor}><input name="userAccountId" type="hidden" value={user.id}/><NoteField id="reset_note" label={labels.resetNote}/><button className={buttonClass} data-testid="btn_confirm_reset_2fa" type="submit">{labels.confirmReset}</button><button className={quietClass} data-testid="btn_cancel_reset_2fa" type="reset">{labels.cancel}</button></form></div></details>
                <details><summary className={quietClass} data-testid="btn_disable_account">{labels.disable}</summary><div data-testid="modal_disable_account"><h3>{labels.disableTitle}</h3><form action={actions.disableUser}><input name="userAccountId" type="hidden" value={user.id}/><input name="companyId" type="hidden" value={user.companyId ?? ""}/><NoteField id="disable_note" label={labels.disableNote}/><button className={buttonClass} data-testid="btn_confirm_disable" type="submit">{labels.confirmDisable}</button><button className={quietClass} data-testid="btn_cancel_disable" type="reset">{labels.cancel}</button></form></div></details>
              </td></tr>)}</tbody></table>
          </div>
        </section>
        <section data-testid="tab_roles"><div className="flex items-end justify-between"><div><h2 className="font-display text-2xl">{labels.rolesTab}</h2><p className="text-sm text-text-secondary">{labels.rolesDescription}</p></div><details><summary className={buttonClass} data-testid="btn_add_role">{labels.addRole}</summary><div data-testid="modal_add_role"><h3>{labels.addRoleTitle}</h3><form action={actions.grantRole} className="space-y-3"><label><span>{labels.user}</span><select className={fieldClass} data-testid="user_account_id" name="userAccountId" required>{users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label><label><span>{labels.company}</span><select className={fieldClass} data-testid="company_id" name="companyId" required>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label><span>{labels.role}</span><select className={fieldClass} data-testid="role" name="role" required><option value="approver">{labels.approver}</option><option value="finance">{labels.finance}</option><option value="viewer">{labels.viewer}</option></select></label><label><span>{labels.validFrom}</span><input className={fieldClass} data-testid="valid_from" name="validFrom" type="date"/></label><label><span>{labels.validTo}</span><input className={fieldClass} data-testid="valid_to" name="validTo" type="date"/></label><NoteField id="grant_note" label={labels.grantNote}/><button className={buttonClass} data-testid="btn_confirm_add_role" type="submit">{labels.confirmAddRole}</button><button className={quietClass} data-testid="btn_cancel_add_role" type="reset">{labels.cancel}</button></form></div></details></div>
          <div className="overflow-x-auto rounded border border-border bg-surface" data-testid="roles_table"><h3 className="p-4 font-semibold">{labels.rolesTitle}</h3><table className="w-full text-left text-sm"><thead><tr>{[labels.user, labels.company, labels.role, labels.validFrom, labels.validTo].map((heading) => <th className="border-t border-border p-3" key={heading}>{heading}</th>)}<th className="border-t border-border p-3"><span className="sr-only">{labels.actionsHeader}</span></th></tr></thead><tbody>{grants.length === 0 ? <tr><td className="p-4 text-text-muted" colSpan={6}>{labels.emptyRoles}</td></tr> : grants.map((grant) => <tr key={grant.id}><td className="border-t border-border p-3">{grant.userEmail}</td><td className="border-t border-border p-3">{grant.companyName}</td><td className="border-t border-border p-3">{roleLabel(grant.role)}</td><td className="border-t border-border p-3">{grant.validFrom ?? labels.none}</td><td className="border-t border-border p-3">{grant.validTo ?? labels.none}</td><td className="border-t border-border p-3"><details><summary className={quietClass} data-testid="btn_remove_role">{labels.removeRole}</summary><div data-testid="modal_remove_role"><h3>{labels.removeRoleTitle}</h3><form action={actions.removeRole}><input name="assignmentId" type="hidden" value={grant.id}/><input name="companyId" type="hidden" value={grant.companyId}/><NoteField id="remove_note" label={labels.removeNote}/><button className={buttonClass} data-testid="btn_confirm_remove_role" type="submit">{labels.confirmRemoveRole}</button><button className={quietClass} data-testid="btn_cancel_remove_role" type="reset">{labels.cancel}</button></form></div></details></td></tr>)}</tbody></table></div>
        </section>
      </section>
    </div>
  );
}
