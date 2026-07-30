import type { AlertSubjectRef, AlertType } from "@smp/contracts/alerts";
import type { RequestState } from "@smp/domain";

import enUS from "./locales/en-US.json" with { type: "json" };
import esEC from "./locales/es-EC.json" with { type: "json" };

export type NotificationLocale = "en-US" | "es-EC";
export type ApprovalAgingNotificationStage = "reminder" | "escalation";
export type ApprovalAgingNotificationInput = {
  readonly approverName: string;
  readonly companyName: string;
  readonly requestNo: string;
};
export type LifecycleNotificationKind =
  | "submission"
  | "new_request_to_approver"
  | "decision"
  | "provisioning_complete";

export type LifecycleNotificationInput = {
  readonly companyName: string;
  readonly publicOrigin: string;
  readonly requestId: string;
  readonly requestNo: string;
  readonly requesterName: string;
  readonly state: RequestState;
};

const catalogs = {
  "en-US": enUS,
  "es-EC": esEC,
} as const;

export function renderAlertNotification(
  locale: NotificationLocale,
  type: AlertType,
  subject: AlertSubjectRef,
): { html: string; subject: string; text: string } {
  const template = catalogs[locale].alert;
  const subjectIdentity = Object.values(subject)[0];
  if (!subjectIdentity) throw new TypeError("alert subject identity is required");
  const values = { subject: subjectIdentity, type };
  return {
    html: interpolate(template.html, values),
    subject: interpolate(template.subject, values),
    text: interpolate(template.text, values),
  };
}

export function renderApprovalAgingNotification(
  locale: NotificationLocale,
  stage: ApprovalAgingNotificationStage,
  input: ApprovalAgingNotificationInput,
): { html: string; subject: string; text: string } {
  const template = catalogs[locale].approvalAging[stage];
  const values = {
    approverName:
      input.approverName.trim() ||
      catalogs[locale].approvalAging.unassignedApprover,
    companyName: input.companyName,
    requestNo: input.requestNo,
  };
  const htmlValues = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, escapeHtml(value)]),
  );
  return {
    html: interpolate(template.html, htmlValues),
    subject: interpolate(template.subject, values),
    text: interpolate(template.text, values),
  };
}

export function renderLifecycleNotification(
  locale: unknown,
  kind: LifecycleNotificationKind,
  input: LifecycleNotificationInput,
): { html: string; subject: string; text: string } {
  const catalog = getNotificationCatalog(locale);
  const template = catalog.lifecycle[kind];
  const url = lifecycleUrl(kind, input.publicOrigin, input.requestId);
  const textValues = {
    companyName: input.companyName,
    requesterName: input.requesterName,
    requestNo: input.requestNo,
    state: catalog.status[input.state],
    url,
  };
  const htmlValues = Object.fromEntries(
    Object.entries(textValues).map(([key, value]) => [key, escapeHtml(value)]),
  );
  return {
    html: interpolate(template.html, htmlValues),
    subject: interpolate(template.subject, textValues),
    text: interpolate(template.text, textValues),
  };
}

function normalizeLocale(locale: unknown): NotificationLocale {
  return locale === "en" || locale === "en-US" ? "en-US" : "es-EC";
}

export function getNotificationCatalog(locale: unknown) {
  return catalogs[normalizeLocale(locale)];
}

function lifecycleUrl(
  kind: LifecycleNotificationKind,
  publicOrigin: string,
  requestId: string,
): string {
  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new TypeError("publicOrigin must be an absolute HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new TypeError("publicOrigin must be an absolute HTTP(S) origin");
  }
  const path =
    kind === "new_request_to_approver"
      ? `/aprobaciones?requestId=${encodeURIComponent(requestId)}`
      : `/solicitudes/${encodeURIComponent(requestId)}`;
  return new URL(path, origin.origin).toString();
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function interpolate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  // Stryker disable next-line StringLiteral: @equivalent Catalog parity tests
  // prove every static placeholder has a supplied value; fallback is unreachable.
  return template.replaceAll(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? "");
}

export const notificationCatalogs = catalogs;
