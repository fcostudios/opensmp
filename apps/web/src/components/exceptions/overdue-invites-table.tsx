"use client";

import { useActionState } from "react";
// eslint-disable-next-line no-restricted-imports -- Type-only serializable command result; this client performs no database access.
import type { InvitationWithdrawalOutcome } from "@smp/db/invitation-withdrawal";
import Link from "next/link";

type WithdrawalAction = { (form:FormData): Promise<InvitationWithdrawalOutcome> };

export interface OverdueInvitesLabels {
  readonly request: string;
  readonly ageHours: string;
  readonly empty: string;
  readonly withdraw: string;
  readonly pending: string;
  readonly note: string;
  readonly success: string;
  readonly errors: Readonly<Record<Extract<InvitationWithdrawalOutcome,{ok:false}>["error"],string>>;
}

export function OverdueInvitesTable({ items, labels, locale, withdrawAction }: {
  readonly items: readonly {
    readonly requestId: string;
    readonly requestNo: string;
    readonly ageHours: number;
    readonly actionId: string;
  }[];
  readonly labels: OverdueInvitesLabels;
  readonly locale: "en-US" | "es-EC";
  readonly withdrawAction?: WithdrawalAction;
}) {
  return (
    <div className="mt-5 overflow-x-auto rounded border border-border bg-surface" data-testid="table_expired_invites">
      {items.length === 0 ? (
        <p className="p-8 text-center text-text-secondary">{labels.empty}</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-sm text-text-secondary">
              <th className="px-3 py-2 font-medium" scope="col">{labels.request}</th>
              <th className="px-3 py-2 font-medium" scope="col">{labels.ageHours}</th>
              {withdrawAction ? <th className="px-3 py-2 font-medium" scope="col">{labels.withdraw}</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={item.requestId}>
                <td className="px-3 py-3">
                  <Link
                    className="font-semibold text-text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    href={`/solicitudes/${item.requestId}`}
                  >
                    {item.requestNo}
                  </Link>
                </td>
                <td className="px-3 py-3 font-mono text-text-secondary">
                  {new Intl.NumberFormat(locale).format(item.ageHours)}
                </td>
                {withdrawAction ? <td className="px-3 py-3"><WithdrawalForm item={item} labels={labels} withdrawAction={withdrawAction} /></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WithdrawalForm({item,labels,withdrawAction}: {
 readonly item: {readonly requestId:string;readonly actionId:string};
 readonly labels:OverdueInvitesLabels;
 readonly withdrawAction:WithdrawalAction;
}) {
 const [result,submit,pending]=useActionState<InvitationWithdrawalOutcome|null,FormData>(async(previous,form)=>{
   if(previous?.ok) return previous;
   try { return await withdrawAction(form); }
   catch { return {ok:false,error:"ambiguous"}; }
 },null);
 return <form action={submit} className="space-y-2" data-testid="form_withdraw_invite">
   <input name="requestId" type="hidden" value={item.requestId} />
   <input name="actionId" type="hidden" value={item.actionId} />
   <input name="commandId" type="hidden" value={item.actionId} />
   <label className="block text-sm text-text-secondary" htmlFor={`withdraw-note-${item.actionId}`}>{labels.note}</label>
   <textarea className="w-full rounded border border-border bg-surface p-2 text-text-primary" id={`withdraw-note-${item.actionId}`} name="note" required maxLength={2000} disabled={pending || result?.ok === true} />
   <button className="min-h-11 rounded border border-border px-3 py-2 font-semibold text-text-primary disabled:opacity-50" type="submit" disabled={pending || result?.ok === true}>{pending ? labels.pending : labels.withdraw}</button>
   {result?.ok ? <p className="text-success-text" role="status">{labels.success}</p> : result ? <p className="text-error-text" role="alert">{labels.errors[result.error]}</p> : null}
 </form>;
}
