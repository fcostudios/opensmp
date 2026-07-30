"use client";

import Link from "next/link";
import {
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import type { PersonInput } from "@smp/contracts";

import type {
  PersonAction,
  PersonActionState,
} from "@/modules/org-registry/actions/people";

export interface PersonFormLabels {
  readonly active: string;
  readonly cancel: string;
  readonly company: string;
  readonly companyError: string;
  readonly companyMoveWarning: string;
  readonly confirmCompanyMove: string;
  readonly departed: string;
  readonly editTitle: string;
  readonly email: string;
  readonly emailError: string;
  readonly emailHelp: string;
  readonly fastTrackCreated: string;
  readonly fastTrackLink: string;
  readonly fullName: string;
  readonly fullNameError: string;
  readonly genericError: string;
  readonly newDescription: string;
  readonly newTitle: string;
  readonly save: string;
  readonly saving: string;
  readonly status: string;
  readonly success: string;
}

export function deriveCompanyMoveState({
  initialCompanyId,
  selectedCompanyId,
  confirmed,
}: {
  readonly initialCompanyId: string;
  readonly selectedCompanyId: string;
  readonly confirmed: boolean;
}) {
  const companyChanged =
    initialCompanyId.length > 0 && initialCompanyId !== selectedCompanyId;
  return {
    companyChanged,
    saveDisabled: companyChanged && !confirmed,
  };
}

type EditablePerson = Pick<
  Required<PersonInput>,
  "id" | "fullName" | "email" | "companyId" | "status"
>;

export function PersonForm({
  action,
  companies,
  initialResult,
  labels,
  mode,
  person: initialPerson,
}: {
  readonly action: PersonAction;
  readonly companies: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly initialResult?: PersonActionState;
  readonly labels: PersonFormLabels;
  readonly mode: "create" | "edit";
  readonly person?: EditablePerson;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [fullName, setFullName] = useState(initialPerson?.fullName ?? "");
  const [email, setEmail] = useState(initialPerson?.email ?? "");
  const [companyId, setCompanyId] = useState(
    initialPerson?.companyId ?? companies[0]?.id ?? "",
  );
  const [status, setStatus] = useState<PersonInput["status"]>(
    initialPerson?.status ?? "active",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<PersonActionState | undefined>(
    initialResult,
  );
  const [pending, startTransition] = useTransition();
  const move = deriveCompanyMoveState({
    initialCompanyId: initialPerson?.companyId ?? "",
    selectedCompanyId: companyId,
    confirmed,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      setResult(
        await action({
          id: initialPerson?.id,
          fullName,
          email,
          companyId,
          status,
          confirmCompanyMove: confirmed,
        }),
      );
    });
  }

  function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFullName(initialPerson?.fullName ?? "");
    setEmail(initialPerson?.email ?? "");
    setCompanyId(initialPerson?.companyId ?? companies[0]?.id ?? "");
    setStatus(initialPerson?.status ?? "active");
    setConfirmed(false);
    setResult(initialResult);
    const details = formRef.current?.closest("details");
    if (details) {
      details.open = false;
      details.querySelector("summary")?.focus();
    }
  }

  const fieldErrors = result?.fieldErrors;

  const submitTestId =
    mode === "create" ? "btn_save_person" : "btn_guardar_persona";
  return (
    <form
      className="space-y-4"
      onReset={cancel}
      onSubmit={submit}
      ref={formRef}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.fullName}</span>
          <input
            aria-describedby={
              fieldErrors?.fullName
                ? `${mode}-fullName-error`
                : undefined
            }
            aria-invalid={fieldErrors?.fullName ? true : undefined}
            className="min-h-11 w-full rounded border border-border bg-surface px-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="full_name"
            maxLength={200}
            onChange={(event) => setFullName(event.target.value)}
            required
            type="text"
            value={fullName}
          />
          {fieldErrors?.fullName ? (
            <span
              className="block text-xs font-normal text-error-text"
              id={`${mode}-fullName-error`}
              role="alert"
            >
              {labels.fullNameError}
            </span>
          ) : null}
        </label>
        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.email}</span>
          <input
            aria-describedby={[
              `${mode}-email-help`,
              fieldErrors?.email ? `${mode}-email-error` : null,
            ]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={fieldErrors?.email ? true : undefined}
            className="min-h-11 w-full rounded border border-border bg-surface px-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <span
            className="block text-xs font-normal text-text-secondary"
            id={`${mode}-email-help`}
          >
            {labels.emailHelp}
          </span>
          {fieldErrors?.email ? (
            <span
              className="block text-xs font-normal text-error-text"
              id={`${mode}-email-error`}
              role="alert"
            >
              {labels.emailError}
            </span>
          ) : null}
        </label>
        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.company}</span>
          <select
            aria-describedby={
              fieldErrors?.companyId
                ? `${mode}-companyId-error`
                : undefined
            }
            aria-invalid={fieldErrors?.companyId ? true : undefined}
            className="min-h-11 w-full rounded border border-border bg-surface px-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="company_id"
            onChange={(event) => {
              setCompanyId(event.target.value);
              setConfirmed(false);
            }}
            required
            value={companyId}
          >
            {companies.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          {fieldErrors?.companyId ? (
            <span
              className="block text-xs font-normal text-error-text"
              id={`${mode}-companyId-error`}
              role="alert"
            >
              {labels.companyError}
            </span>
          ) : null}
        </label>
        {mode === "edit" ? (
          <label className="space-y-1 text-sm font-medium text-text-secondary">
            <span>{labels.status}</span>
            <select
              className="min-h-11 w-full rounded border border-border bg-surface px-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="status"
              onChange={(event) =>
                setStatus(event.target.value as PersonInput["status"])
              }
              value={status}
            >
              <option value="active">{labels.active}</option>
              <option value="departed">{labels.departed}</option>
            </select>
          </label>
        ) : null}
      </div>

      {move.companyChanged ? (
        <div
          className="rounded border border-pending-dot bg-pending-bg p-4 text-pending-text"
          role="alert"
        >
          <p>{labels.companyMoveWarning}</p>
          <label className="mt-3 flex min-h-11 items-center gap-3 font-medium">
            <input
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>{labels.confirmCompanyMove}</span>
          </label>
        </div>
      ) : null}

      <div aria-live="polite" role="status">
        {result?.ok ? (
          <p className="text-success">
            {result.reRequestHref ? (
              <>
                {labels.fastTrackCreated}{" "}
                <Link
                  className="font-semibold text-primary underline"
                  href={result.reRequestHref}
                >
                  {labels.fastTrackLink}
                </Link>
              </>
            ) : (
              labels.success
            )}
          </p>
        ) : result?.globalError ? (
          <p className="text-error-text">{labels.genericError}</p>
        ) : null}
      </div>

      <div className="flex justify-end gap-3">
        <button
          className="min-h-11 rounded border border-border px-4 text-text-secondary"
          type="reset"
        >
          {labels.cancel}
        </button>
        <button
          className="min-h-11 rounded bg-primary px-5 font-semibold text-text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={submitTestId}
          disabled={pending || move.saveDisabled}
          type="submit"
        >
          {pending ? labels.saving : labels.save}
        </button>
      </div>
    </form>
  );
}
