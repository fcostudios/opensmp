import type { RegisterFilters } from "@smp/contracts/register";
import { exportRegisterCsv } from "@/modules/register/server-actions";
import { RegisterExportControl } from "./register-export-control";

export function RegisterExportButton({ errorLabel, filters, label }: {
  readonly errorLabel: string;
  readonly filters: RegisterFilters;
  readonly label: string;
}) {
  return (
    <RegisterExportControl
      errorLabel={errorLabel}
      filters={filters}
      label={label}
      requestDownload={exportRegisterCsv}
    />
  );
}
