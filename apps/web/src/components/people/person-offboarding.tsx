"use client";

import {
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OffboardingActionResponse } from "@/modules/org-registry/people-action-service";
import type { StartOffboardingInput } from "@smp/contracts";

import type {
  StartOffboardingAction,
} from "@/modules/org-registry/actions/people";

export interface PersonOffboardingLabels {
  readonly cancel: string;
  readonly confirmOffboarding: string;
  readonly inactive: string;
  readonly leftCompany: string;
  readonly offboardingDescription: string;
  readonly offboardingError: string;
  readonly offboardingNote: string;
  readonly offboardingNotePlaceholder: string;
  readonly offboardingReason: string;
  readonly offboardingSubmitting: string;
  readonly offboardingSuccess: string;
  readonly offboardingTitle: string;
  readonly offboardingUnavailable: string;
  readonly reallocated: string;
  readonly startOffboarding: string;
}

export function PersonOffboarding({
  action,
  labels: suppliedLabels,
  personId,
  fixedRequestId,
  targets: suppliedTargets,
}: {
  readonly action: StartOffboardingAction;
  readonly labels?: PersonOffboardingLabels;
  readonly personId: string;
  readonly fixedRequestId?: string;
  readonly targets?: readonly {readonly requestId:string;readonly label:string}[];
}) {
  const t=useTranslations("people");
  const labelKeys=["cancel","confirmOffboarding","inactive","leftCompany","offboardingDescription","offboardingError","offboardingNote","offboardingNotePlaceholder","offboardingReason","offboardingSubmitting","offboardingSuccess","offboardingTitle","offboardingUnavailable","reallocated","startOffboarding"] as const;
  const labels=suppliedLabels??Object.fromEntries(labelKeys.map(key=>[key,t(key)])) as unknown as PersonOffboardingLabels;
  const [targets,setTargets]=useState(suppliedTargets??[]);
  const [requestId,setRequestId]=useState("");
  const [loaded,setLoaded]=useState(suppliedTargets!==undefined || fixedRequestId!==undefined);
  const [loadingTargets,setLoadingTargets]=useState(false);
  const target=fixedRequestId??requestId;
  const openerRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [endReason, setEndReason] =
    useState<StartOffboardingInput["endReason"]>("left_company");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<
    OffboardingActionResponse | undefined
  >();
  const [pending, startTransition] = useTransition();

  async function loadTargets() {
    if(loaded || loadingTargets)return;
    setLoadingTargets(true);
    try {
      const response=await action({intent:"read_targets",personId});
      if(response.ok){setTargets(response.targets??[]);setLoaded(true);}
      else{setTargets([]);setResult(response);}
    }catch{setResult({ok:false,globalError:"person_offboarding_failed"});}
    finally{setLoadingTargets(false);}
  }

  function close() {
    setOpen(false);
    setNote("");
    setResult(undefined);
    openerRef.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!target || pending || loadingTargets || !note.trim())return;
    startTransition(async () => {
      const next = await action({ personId, requestId:target, endReason, note });
      setResult(next);
      if (next.ok) {
        setOpen(false);
        setNote("");
        openerRef.current?.focus();
      }
    });
  }

  return (
    <div>
      <details
        className="rounded border border-border bg-surface p-3"
        data-testid="modal_offboarding"
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          if(event.currentTarget.open && !fixedRequestId)void loadTargets();
        }}
        open={open}
      >
        <summary
          className="cursor-pointer font-semibold"
          data-testid="btn_start_offboarding"
          ref={openerRef}
        >
          {labels.startOffboarding}
        </summary>
        <div className="mt-4 space-y-3">
          <h2 className="font-display text-xl font-semibold">
            {labels.offboardingTitle}
          </h2>
          <p className="text-sm text-text-secondary">
            {labels.offboardingDescription}
          </p>
          <form className="space-y-3" onSubmit={submit}>
            <input type="hidden" name="personId" value={personId} data-testid="offboarding_person_id"/>
            {fixedRequestId ? <input type="hidden" name="requestId" value={fixedRequestId} data-testid="offboarding_request_id"/> : (
              <label className="block space-y-1 text-sm font-medium">
                <span>{t("offboardingTarget")}</span>
                <select name="requestId" data-testid="offboarding_target" className="min-h-11 w-full rounded border border-border px-3" value={requestId} onChange={event=>setRequestId(event.target.value)} required disabled={loadingTargets}>
                  <option value="">{t("offboardingSelectTarget")}</option>
                  {targets.map(choice=><option key={choice.requestId} value={choice.requestId}>{choice.label}</option>)}
                </select>
              </label>
            )}
            {loadingTargets ? <p role="status">{t("offboardingLoadingTargets")}</p> : loaded && !fixedRequestId && targets.length===0 ? <p>{labels.offboardingUnavailable}</p> : null}
            <label className="block space-y-1 text-sm font-medium">
              <span>{labels.offboardingReason}</span>
              <select
                className="min-h-11 w-full rounded border border-border px-3"
                data-testid="end_reason"
                onChange={(event) =>
                  setEndReason(
                    event.target
                      .value as StartOffboardingInput["endReason"],
                  )
                }
                required
                value={endReason}
              >
                <option value="left_company">
                  {labels.leftCompany}
                </option>
                <option value="inactive">{labels.inactive}</option>
              </select>
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>{labels.offboardingNote}</span>
              <textarea
                className="min-h-24 w-full rounded border border-border p-3"
                data-testid="offboarding_note"
                maxLength={1_000}
                onChange={(event) => setNote(event.target.value)}
                placeholder={labels.offboardingNotePlaceholder}
                required
                value={note}
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                className="min-h-11 rounded border border-border px-4"
                data-testid="btn_cancel_offboarding"
                onClick={close}
                type="button"
              >
                {labels.cancel}
              </button>
              <button
                className="min-h-11 rounded bg-primary px-4 text-text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="btn_confirm_offboarding"
                disabled={pending || loadingTargets || !target || note.trim().length === 0}
                type="submit"
              >
                {pending
                  ? labels.offboardingSubmitting
                  : labels.confirmOffboarding}
              </button>
            </div>
          </form>
        </div>
      </details>
      <div aria-live="polite" role="status">
        {result?.ok ? (
          <div className="mt-2 text-success">
            <p>{labels.offboardingSuccess}</p>
            <p>{t("offboardingPending")}</p>
            {result.affectedRequestIds?.[0] ? <Link href={`/solicitudes/${result.affectedRequestIds[0]}`} className="font-semibold underline">{t("offboardingViewRequest")}</Link> : null}
          </div>
        ) : result?.globalError ? (
          <p className="mt-2 text-error-text">
            {result.globalError ===
            "person_offboarding_unavailable"
              ? labels.offboardingUnavailable
              : result.globalError === "person_offboarding_transfer_required" ? t("offboardingTransferRequired") : labels.offboardingError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
