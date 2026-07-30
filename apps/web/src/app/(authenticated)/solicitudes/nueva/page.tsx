import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { hasCapability } from "@smp/domain/identity-access";

import {
  RequestForm,
  type RequestFormLabels,
} from "@/components/requests/request-form";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { requestRepository } from "@/modules/request-workflow/repository";

export default async function ScrNewRequestPage() {
  const authorization = await loadCurrentLedgerAuthorization();
  if (
    !authorization ||
    !hasCapability(authorization, "request:create")
  ) {
    redirect("/acceso-denegado");
  }
  const [options, t, locale] = await Promise.all([
    requestRepository.formOptions(authorization),
    getTranslations("requestIntake"),
    getLocale(),
  ]);
  const keys = [
    "title", "description", "requestFor", "self", "onBehalf",
    "personEmail", "personEmailHelp", "personFullName", "personCompany",
    "companyHelp", "vendorAccount", "selectVendor", "licenseType",
    "selectLicense", "justification", "justificationPlaceholder", "neededBy",
    "neededByHelp", "submit", "submitting", "cancel", "success",
    "genericError", "forbidden", "inactiveCompany", "inactiveVendor",
    "inactiveLicense", "personConflict", "duplicate", "viewAssignment",
    "unknownDomain", "missingRate", "budgetWarning", "nextTitle", "viewRequest",
    "nextDescription",
  ] as const satisfies readonly (keyof RequestFormLabels)[];
  const labels = Object.fromEntries(
    keys.map((key) => [key, t(key)]),
  ) as unknown as RequestFormLabels;

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">
          {t("title")}
        </p>
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {t("title")}
        </h1>
        <p className="mt-1 text-text-secondary">{t("description")}</p>
      </header>
      <RequestForm
        labels={labels}
        locale={locale === "en-US" ? "en-US" : "es-EC"}
        options={options}
      />
    </main>
  );
}
