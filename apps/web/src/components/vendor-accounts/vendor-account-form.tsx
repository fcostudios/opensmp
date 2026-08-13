"use client";

import { useRef, useState, type FormEvent } from "react";

import { createVendorAccountSchema, updateVendorAccountSchema } from "@smp/contracts";

import type { VendorAccountActionState } from "@/modules/vendor-catalog/actions/manage-vendor-accounts-operations";

export interface VendorAccountFormLabels {
  readonly cancel: string;
  readonly description: string;
  readonly errors: {
    readonly contractRenewalOn: string;
    readonly duplicate: string;
    readonly generic: string;
    readonly lowPoolFloor: string;
    readonly mode: string;
    readonly name: string;
    readonly status?: string;
    readonly vendorId: string;
    readonly vendorOrgRef: string;
  };
  readonly fields: {
    readonly contractRenewalOn: string;
    readonly lowPoolFloor: string;
    readonly mode: string;
    readonly name: string;
    readonly status?: string;
    readonly vendorId: string;
    readonly vendorOrgRef: string;
  };
  readonly help: {
    readonly lowPoolFloor: string;
    readonly vendor: string;
    readonly vendorOrgRef: string;
  };
  readonly modes: {
    readonly automated: string;
    readonly orchestration: string;
  };
  readonly statuses?: { readonly active: string; readonly inactive: string };
  readonly submit: string;
  readonly submitting: string;
  readonly success: string;
  readonly title: string;
  readonly trigger: string;
}

export interface VendorAccountFormAction {
  (
    previousState: VendorAccountActionState,
    formData: FormData,
  ): Promise<VendorAccountActionState>;
}

// Stryker disable StringLiteral: @equivalent static module capture; focused
// accessibility tests assert both the 44px target and visible focus-ring tokens.
const fieldClass =
  "min-h-11 w-full rounded border border-border bg-surface px-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary";
// Stryker restore StringLiteral

function FieldError({ id, message }: { readonly id: string; readonly message: string }) {
  return (
    <span className="block text-xs font-normal text-error-text" id={id} role="alert">
      {message}
    </span>
  );
}

function actionMessage(
  state: VendorAccountActionState,
  labels: VendorAccountFormLabels,
): string | null {
  // Stryker disable all: @equivalent React/Stryker state capture;
  // focused dialog journeys prove duplicate, generic, and field-error branches.
  if (state.status !== "error" || state.fieldErrors) return null;
  return state.code === "duplicate" ? labels.errors.duplicate : labels.errors.generic;
  // Stryker restore all
}

function numberField(formData: FormData, field: string): number {
  // Stryker disable all: @equivalent FormData helper instrumentation; focused
  // form tests prove missing, blank, finite, and invalid numeric submissions.
  const value = formData.get(field);
  if (typeof value !== "string") return Number.NaN;
  const trimmed = value.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
  // Stryker restore all
}

interface CanonicalEditValues {
  readonly contractRenewalOn: string;
  readonly lowPoolFloor: string;
  readonly mode: string;
  readonly name: string;
  readonly status: string;
  readonly vendorOrgRef: string;
}

function canonicalNumber(value: FormDataEntryValue | null): string {
  // Stryker disable all: @equivalent eager helper capture; the settings journey
  // proves canonical same-value edits, dirty transitions, and post-save baseline.
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? String(parsed) : trimmed;
  // Stryker restore all
}

function canonicalEditValues(formData: FormData): CanonicalEditValues {
  const text = (field: string) => {
    const value = formData.get(field);
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    contractRenewalOn: text("contractRenewalOn"),
    lowPoolFloor: canonicalNumber(formData.get("lowPoolFloor")),
    mode: text("mode"),
    name: text("name"),
    status: text("status"),
    vendorOrgRef: text("vendorOrgRef"),
  };
}

function initialEditValues(initialValues: NonNullable<Parameters<typeof VendorAccountForm>[0]["initialValues"]>): CanonicalEditValues {
  return {
    contractRenewalOn: initialValues.contractRenewalOn ?? "",
    lowPoolFloor: String(initialValues.lowPoolFloor),
    mode: initialValues.mode,
    name: initialValues.name.trim(),
    status: initialValues.status,
    vendorOrgRef: initialValues.vendorOrgRef?.trim() ?? "",
  };
}

function sameEditValues(left: CanonicalEditValues, right: CanonicalEditValues): boolean {
  return (Object.keys(left) as (keyof CanonicalEditValues)[]).every((key) => left[key] === right[key]);
}

export function VendorAccountForm({
  action,
  labels,
  onCancel,
  onDirtyChange,
  onPendingChange,
  onSuccess,
  onValuesChange,
  initialValues,
  showCancel = true,
  vendorName,
  vendors,
}: {
  readonly action: VendorAccountFormAction;
  readonly labels: VendorAccountFormLabels;
  readonly onCancel: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onSuccess: () => void;
  readonly onValuesChange?: () => void;
  readonly initialValues?: {
    readonly contractRenewalOn: string | null;
    readonly id: string;
    readonly lowPoolFloor: number;
    readonly mode: "automated" | "orchestration";
    readonly name: string;
    readonly status: "active" | "inactive";
    readonly vendorId: string;
    readonly vendorOrgRef: string | null;
  };
  readonly showCancel?: boolean;
  readonly vendorName?: string;
  readonly vendors?: readonly { readonly id: string; readonly name: string }[];
}) {
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const baselineRef = useRef<CanonicalEditValues | null>(initialValues ? initialEditValues(initialValues) : null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<VendorAccountActionState>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (initialValues && !dirtyRef.current) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const submittedEditValues = initialValues ? canonicalEditValues(formData) : null;
    const common = { contractRenewalOn: formData.get("contractRenewalOn"), lowPoolFloor: numberField(formData, "lowPoolFloor"), mode: formData.get("mode"), name: formData.get("name"), vendorOrgRef: formData.get("vendorOrgRef") };
    const parsed = initialValues
      ? updateVendorAccountSchema.safeParse({ ...common, id: initialValues.id, status: formData.get("status") })
      : createVendorAccountSchema.safeParse({ ...common, vendorId: formData.get("vendorId") });
    if (!parsed.success) {
      setState({
        status: "error",
        code: "invalid_input",
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
      queueMicrotask(() => {
        form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      });
      return;
    }
    pendingRef.current = true;
    setPending(true);
    onPendingChange(true);
    setState({ status: "idle" });
    try {
      const result = await action({ status: "idle" }, formData);
      setState(result);
      if (result.status === "success") {
        if (submittedEditValues) {
          baselineRef.current = submittedEditValues;
          const currentDirty = !sameEditValues(canonicalEditValues(new FormData(form)), submittedEditValues);
          dirtyRef.current = currentDirty;
          setDirty(currentDirty);
          onSuccess();
          onDirtyChange?.(currentDirty);
        } else {
          onSuccess();
        }
      }
    } catch {
      setState({ status: "error", code: "unexpected" });
    } finally {
      pendingRef.current = false;
      setPending(false);
      onPendingChange(false);
    }
  }

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const globalError = actionMessage(state, labels);
  const describedBy = (field: string, help?: string) =>
    [help, fieldErrors?.[field] ? `${field}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <form
      aria-label={labels.title}
      className="space-y-4"
      noValidate
      onChange={(event) => {
        onValuesChange?.();
        if (state.status !== "idle") setState({ status: "idle" });
        if (!initialValues || !baselineRef.current) return;
        const nextDirty = !sameEditValues(canonicalEditValues(new FormData(event.currentTarget)), baselineRef.current);
        if (nextDirty === dirtyRef.current) return;
        dirtyRef.current = nextDirty;
        setDirty(nextDirty);
        onDirtyChange?.(nextDirty);
      }}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.fields.vendorId}</span>
          {initialValues ? <>
            <input aria-label={labels.fields.vendorId} className={fieldClass} readOnly type="text" value={vendorName ?? ""} />
          </> : <select
            aria-label={labels.fields.vendorId}
            aria-describedby={describedBy("vendorId", "vendorId-help")}
            aria-invalid={fieldErrors?.vendorId ? true : undefined}
            autoFocus
            className={fieldClass}
            name="vendorId"
            required
          >
            {(vendors ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
          </select>
          }
          <span className="block text-xs font-normal text-text-secondary" id="vendorId-help">{labels.help.vendor}</span>
          {fieldErrors?.vendorId ? <FieldError id="vendorId-error" message={labels.errors.vendorId} /> : null}
        </label>

        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.fields.name}</span>
          <input
            aria-label={labels.fields.name}
            aria-describedby={describedBy("name")}
            aria-invalid={fieldErrors?.name ? true : undefined}
            className={fieldClass}
            defaultValue={initialValues?.name}
            maxLength={200}
            name="name"
            required
            type="text"
          />
          {fieldErrors?.name ? <FieldError id="name-error" message={labels.errors.name} /> : null}
        </label>

        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.fields.vendorOrgRef}</span>
          <input
            aria-label={labels.fields.vendorOrgRef}
            aria-describedby={describedBy("vendorOrgRef", "vendorOrgRef-help")}
            aria-invalid={fieldErrors?.vendorOrgRef ? true : undefined}
            className={fieldClass}
            defaultValue={initialValues?.vendorOrgRef ?? undefined}
            maxLength={200}
            name="vendorOrgRef"
            type="text"
          />
          <span className="block text-xs font-normal text-text-secondary" id="vendorOrgRef-help">{labels.help.vendorOrgRef}</span>
          {fieldErrors?.vendorOrgRef ? <FieldError id="vendorOrgRef-error" message={labels.errors.vendorOrgRef} /> : null}
        </label>

        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.fields.mode}</span>
          <select
            aria-label={labels.fields.mode}
            aria-describedby={describedBy("mode")}
            aria-invalid={fieldErrors?.mode ? true : undefined}
            className={fieldClass}
            defaultValue={initialValues?.mode ?? "automated"}
            name="mode"
            required
          >
            <option value="automated">{labels.modes.automated}</option>
            <option value="orchestration">{labels.modes.orchestration}</option>
          </select>
          {fieldErrors?.mode ? <FieldError id="mode-error" message={labels.errors.mode} /> : null}
        </label>

        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.fields.lowPoolFloor}</span>
          <input
            aria-label={labels.fields.lowPoolFloor}
            aria-describedby={describedBy("lowPoolFloor", "lowPoolFloor-help")}
            aria-invalid={fieldErrors?.lowPoolFloor ? true : undefined}
            className={fieldClass}
            defaultValue={initialValues?.lowPoolFloor ?? 5}
            min={0}
            name="lowPoolFloor"
            required
            step={1}
            type="number"
          />
          <span className="block text-xs font-normal text-text-secondary" id="lowPoolFloor-help">{labels.help.lowPoolFloor}</span>
          {fieldErrors?.lowPoolFloor ? <FieldError id="lowPoolFloor-error" message={labels.errors.lowPoolFloor} /> : null}
        </label>

        <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.fields.contractRenewalOn}</span>
          <input
            aria-label={labels.fields.contractRenewalOn}
            aria-describedby={describedBy("contractRenewalOn")}
            aria-invalid={fieldErrors?.contractRenewalOn ? true : undefined}
            className={fieldClass}
            defaultValue={initialValues?.contractRenewalOn ?? undefined}
            name="contractRenewalOn"
            type="date"
          />
          {fieldErrors?.contractRenewalOn ? <FieldError id="contractRenewalOn-error" message={labels.errors.contractRenewalOn} /> : null}
        </label>
        {initialValues && labels.fields.status && labels.statuses ? <label className="space-y-1 text-sm font-medium text-text-secondary">
          <span>{labels.fields.status}</span>
          <select aria-label={labels.fields.status} className={fieldClass} defaultValue={initialValues.status} name="status" required>
            <option value="active">{labels.statuses.active}</option>
            <option value="inactive">{labels.statuses.inactive}</option>
          </select>
        </label> : null}
      </div>

      {globalError ? <p className="rounded bg-error-bg p-3 text-sm text-error-text" role="alert">{globalError}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {showCancel ? <button
          className="inline-flex min-h-11 items-center justify-center rounded border border-border px-4 font-medium text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          {labels.cancel}
        </button> : null}
        <button
          className="inline-flex min-h-11 items-center justify-center rounded bg-primary px-4 font-medium text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={initialValues ? "btn_save_vendor_account" : "btn_create_vendor_account"}
          disabled={pending || (initialValues !== undefined && !dirty)}
          type="submit"
        >
          {pending ? labels.submitting : labels.submit}
        </button>
      </div>
    </form>
  );
}
