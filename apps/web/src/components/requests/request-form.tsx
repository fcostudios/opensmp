"use client";

import Link from "next/link";
import { useState } from "react";

import { formatUsd } from "@smp/ui";

import { deriveDomainSuggestion } from "./domain-suggestion";
import { useRequestSubmissionController } from "./request-submission-controller";
import { executeRequestSubmission } from "./request-submission-executor";

export interface RequestFormLabels {
  readonly title: string;
  readonly description: string;
  readonly requestFor: string;
  readonly self: string;
  readonly onBehalf: string;
  readonly personEmail: string;
  readonly personEmailHelp: string;
  readonly personFullName: string;
  readonly personCompany: string;
  readonly companyHelp: string;
  readonly vendorAccount: string;
  readonly selectVendor: string;
  readonly licenseType: string;
  readonly selectLicense: string;
  readonly justification: string;
  readonly justificationPlaceholder: string;
  readonly neededBy: string;
  readonly neededByHelp: string;
  readonly submit: string;
  readonly submitting: string;
  readonly cancel: string;
  readonly success: string;
  readonly genericError: string;
  readonly forbidden: string;
  readonly inactiveCompany: string;
  readonly inactiveVendor: string;
  readonly inactiveLicense: string;
  readonly personConflict: string;
  readonly duplicate: string;
  readonly viewAssignment: string;
  readonly viewRequest: string;
  readonly unknownDomain: string;
  readonly missingRate: string;
  readonly budgetWarning: string;
  readonly nextTitle: string;
  readonly nextDescription: string;
}

export interface RequestFormOptions {
  readonly allowOnBehalf: boolean;
  readonly companies: readonly {
    readonly id: string;
    readonly name: string;
    readonly domains: readonly string[];
  }[];
  readonly vendorAccounts: readonly {
    readonly id: string;
    readonly name: string;
    readonly licenseTypes: readonly {
      readonly id: string;
      readonly name: string;
    }[];
  }[];
}

const fieldClass =
  "min-h-11 w-full rounded border border-border bg-surface px-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary";

export function RequestForm({
  labels,
  locale = "es-EC",
  options,
}: {
  readonly labels: RequestFormLabels;
  readonly locale?: "es-EC" | "en-US";
  readonly options: RequestFormOptions;
}) {
  const controller = useRequestSubmissionController({
    execute: executeRequestSubmission,
  });
  const {
    pending,
    requestFor,
    result,
    setRequestFor,
    submit,
    succeeded,
  } = controller;
  const [vendorAccountId, setVendorAccountId] = useState(
    options.vendorAccounts[0]?.id ?? "",
  );
  const [personEmail, setPersonEmail] = useState("");
  const [personCompanyId, setPersonCompanyId] = useState(
    options.companies[0]?.id ?? "",
  );
  const selectedAccount = options.vendorAccounts.find(
    ({ id }) => id === vendorAccountId,
  );
  const domainSuggestion = deriveDomainSuggestion(
    personEmail,
    options.companies,
  );

  const errorMessage =
    result && !result.ok
      ? {
          forbidden: labels.forbidden,
          self_identity_unavailable: labels.forbidden,
          on_behalf_forbidden: labels.forbidden,
          company_inactive: labels.inactiveCompany,
          vendor_account_inactive: labels.inactiveVendor,
          license_type_inactive: labels.inactiveLicense,
          person_email_conflict: labels.personConflict,
          active_assignment_exists: labels.duplicate,
          invalid_request: labels.genericError,
          vendor_license_mismatch: labels.genericError,
          person_inactive: labels.genericError,
          submission_failed: labels.genericError,
          idempotency_conflict: labels.genericError,
        }[result.error]
      : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form
        aria-busy={pending}
        className="space-y-6 rounded border border-border bg-surface p-5 shadow-sm sm:p-7"
        data-testid="form_new_request"
        onSubmit={submit}
      >
        <header className="border-b border-border pb-4">
          <h2 className="font-display text-2xl font-semibold text-text-primary">
            {labels.title}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {labels.description}
          </p>
        </header>

        <fieldset
          className="space-y-2"
          data-testid="field_request_for"
        >
          <legend className="text-sm font-semibold text-text-primary">
            {labels.requestFor}
          </legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex min-h-11 items-center gap-2 text-sm text-text-primary">
              <input
                autoFocus
                checked={requestFor === "self"}
                name="requestFor"
                onChange={() => setRequestFor("self")}
                type="radio"
                value="self"
              />
              {labels.self}
            </label>
            {options.allowOnBehalf ? (
              <label className="flex min-h-11 items-center gap-2 text-sm text-text-primary">
                <input
                  checked={requestFor === "on_behalf"}
                  name="requestFor"
                  onChange={() => setRequestFor("on_behalf")}
                  type="radio"
                  value="on_behalf"
                />
                {labels.onBehalf}
              </label>
            ) : null}
          </div>
        </fieldset>

        {requestFor === "on_behalf" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-text-secondary">
              <span>{labels.personEmail}</span>
              <input
                aria-describedby="person-email-help"
                className={fieldClass}
                data-testid="field_person_email"
                name="personEmail"
                onChange={(event) => {
                  const nextEmail = event.target.value;
                  setPersonEmail(nextEmail);
                  const suggestion = deriveDomainSuggestion(
                    nextEmail,
                    options.companies,
                  );
                  if (suggestion.kind === "unique") {
                    setPersonCompanyId(suggestion.companyId);
                  }
                }}
                required
                type="email"
                value={personEmail}
              />
              <span className="block text-xs font-normal" id="person-email-help">
                {labels.personEmailHelp}
              </span>
            </label>
            <label className="space-y-1 text-sm font-medium text-text-secondary">
              <span>{labels.personFullName}</span>
              <input
                className={fieldClass}
                data-testid="field_person_full_name"
                maxLength={200}
                name="personFullName"
                required
                type="text"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-text-secondary sm:col-span-2">
              <span>{labels.personCompany}</span>
              <select
                aria-describedby="person-company-help"
                className={fieldClass}
                data-testid="field_person_company"
                name="personCompanyId"
                onChange={(event) => setPersonCompanyId(event.target.value)}
                required
                value={personCompanyId}
              >
                {options.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <span className="block text-xs font-normal" id="person-company-help">
                {labels.companyHelp}
              </span>
            </label>
            {domainSuggestion.kind === "unknown" ||
            domainSuggestion.kind === "ambiguous" ? (
              <p
                className="text-sm text-warning-text sm:col-span-2"
                data-testid="domain_warning"
                role="status"
              >
                {labels.unknownDomain}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-text-secondary">
            <span>{labels.vendorAccount}</span>
            <select
              className={fieldClass}
              data-testid="field_vendor_account"
              name="vendorAccountId"
              onChange={(event) => setVendorAccountId(event.target.value)}
              required
              value={vendorAccountId}
            >
              <option disabled value="">{labels.selectVendor}</option>
              {options.vendorAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-text-secondary">
            <span>{labels.licenseType}</span>
            <select
              className={fieldClass}
              data-testid="field_license_type"
              key={vendorAccountId}
              name="licenseTypeId"
              required
            >
              <option disabled value="">{labels.selectLicense}</option>
              {selectedAccount?.licenseTypes.map((licenseType) => (
                <option key={licenseType.id} value={licenseType.id}>
                  {licenseType.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.justification}</span>
          <textarea
            className={`${fieldClass} min-h-32 py-3`}
            data-testid="field_justification"
            maxLength={2_000}
            name="justification"
            placeholder={labels.justificationPlaceholder}
            required
          />
        </label>
        <label className="block max-w-sm space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.neededBy}</span>
          <input
            aria-describedby="needed-by-help"
            className={fieldClass}
            data-testid="field_needed_by"
            name="neededBy"
            type="date"
          />
          <span className="block text-xs font-normal" id="needed-by-help">
            {labels.neededByHelp}
          </span>
        </label>

        <div aria-live="polite" className="space-y-2">
          {errorMessage ? (
            <div className="rounded bg-error-bg p-3 text-sm text-error-text" role="alert">
              <p>{errorMessage}</p>
              {result && !result.ok && result.href ? (
                <Link
                  className="font-semibold underline"
                  data-testid="btn_ver_asignacion"
                  href={result.href}
                >
                  {labels.viewAssignment}
                </Link>
              ) : null}
            </div>
          ) : null}
          {result?.ok ? (
            <div className="space-y-2" role="status">
              <p
                className="rounded bg-success-bg p-3 text-sm text-success-text"
                data-testid="success"
              >
                {labels.success}
              </p>
              {result.warnings.map((warning) =>
                warning.code === "unknown_email_domain" ? (
                  <p className="text-sm text-warning-text" data-testid="domain_warning" key={warning.code}>
                    {labels.unknownDomain}
                  </p>
                ) : warning.code === "missing_rate" ? (
                  <p className="text-sm text-warning-text" data-testid="missing_rate" key={warning.code}>
                    {labels.missingRate}
                  </p>
                ) : (
                  <p className="text-sm text-warning-text" data-testid="budget_warning" key={warning.code}>
                    {labels.budgetWarning
                      .replace(
                        "{budget}",
                        formatUsd(warning.budgetMonthlyUsd, locale),
                      )
                      .replace(
                        "{committed}",
                        formatUsd(warning.committedRunRateUsd, locale),
                      )
                      .replace(
                        "{projected}",
                        formatUsd(warning.projectedRunRateUsd, locale),
                      )}
                  </p>
                ),
              )}
              <Link
                className="inline-flex min-h-11 items-center rounded bg-action-primary px-4 text-sm font-semibold text-action-primary-foreground"
                data-testid="btn_ver_solicitud"
                href={result.redirectTo}
              >
                {labels.viewRequest}
              </Link>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
          <Link
            className="inline-flex min-h-11 items-center rounded border border-border px-4 text-sm font-semibold text-text-secondary"
            data-testid="btn_cancel_request"
            href="/solicitudes"
          >
            {labels.cancel}
          </Link>
          <button
            className="min-h-11 rounded bg-action-primary px-5 text-sm font-semibold text-action-primary-foreground disabled:opacity-60"
            data-testid="btn_submit_request"
            disabled={pending || succeeded}
            type="submit"
          >
            {pending ? labels.submitting : labels.submit}
          </button>
        </div>
      </form>

      <aside
        className="h-fit border-l-4 border-primary bg-surface-muted p-5"
        data-testid="banner_what_happens_next"
      >
        <h2 className="font-display text-lg font-semibold text-text-primary">
          {labels.nextTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          {labels.nextDescription}
        </p>
      </aside>
    </div>
  );
}
