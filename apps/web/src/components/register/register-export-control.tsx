"use client";

import { useState, useTransition } from "react";

import type { RegisterFilters } from "@smp/contracts/register";
import type { exportRegisterCsv } from "@/modules/register/server-actions";

interface RegisterExportControlProps {
  readonly errorLabel: string;
  readonly filters: RegisterFilters;
  readonly label: string;
  readonly requestDownload: typeof exportRegisterCsv;
}

export function RegisterExportControl({
  errorLabel,
  filters,
  label,
  requestDownload,
}: RegisterExportControlProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function requestExport() {
    setError(null);
    startTransition(async () => {
      try {
        const { downloadUrl } = await requestDownload(filters);
        window.location.assign(downloadUrl);
      } catch {
        setError(errorLabel);
      }
    });
  }

  return (
    <div className="grid justify-items-end gap-2">
      <button
        className="min-h-11 rounded border border-border px-4 font-semibold text-text-primary"
        disabled={pending}
        onClick={requestExport}
        type="button"
      >
        {label}
      </button>
      {error ? (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
