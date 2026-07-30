import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import {
  REQUEST_STATUSES,
  type RequestStatus,
} from "@smp/ui";

import { ChecklistPanel } from "@/components/requests/checklist-panel";
import { RequestDetailFeedback } from "@/components/requests/request-detail-feedback";
import { RequestDetailDecision } from "@/components/requests/request-detail-decision";
import {
  RequestRecord,
  type RequestRecordLabels,
  type RequestRecordTab,
} from "@/components/requests/request-record";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import {
  confirmChecklistDone,
  markChecklistNotDone,
} from "@/modules/request-workflow/actions/checklist";
import { decideRequest } from "@/modules/request-workflow/actions/decide-request";
import { createOrchestrationService } from "@/modules/request-workflow/orchestration";
import {
  requestReadRepository,
  requestRepository,
} from "@/modules/request-workflow/repository";
import { canDecideRequestDetail } from "@/modules/request-workflow/request-detail-decision-policy";

function activeTab(value: string | undefined): RequestRecordTab {
  return value === "assignment" || value === "audit" ? value : "actions";
}

export default async function ScrRequestDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly requestId: string }>;
  readonly searchParams: Promise<{
    readonly created?: string;
    readonly tab?: string;
  }>;
}) {
  const [
    { requestId },
    query,
    authorization,
    locale,
    history,
    status,
    intake,
    orchestration,
    approval,
  ] = await Promise.all([
    params,
    searchParams,
    loadCurrentLedgerAuthorization(),
    getLocale(),
    getTranslations("requestHistory"),
    getTranslations("status"),
    getTranslations("requestIntake"),
    getTranslations("orchestration"),
    getTranslations("approvalQueue"),
  ]);
  if (!authorization) redirect("/acceso-denegado");
  const record = await requestReadRepository.detail(authorization, requestId);
  if (!record) {
    const assignment = await requestRepository.requestDetail(
      authorization,
      requestId,
    );
    if (!assignment || assignment.kind !== "assignment") notFound();
    return (
      <main className="space-y-4 p-4 sm:p-6">
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {intake("viewAssignment")}
        </h1>
        <p
          className="rounded-lg border border-border bg-surface p-4 font-mono text-sm text-text-secondary"
          data-testid="assignment_reference"
        >
          {intake("assignmentReference", { id: assignment.assignmentId })}
        </p>
      </main>
    );
  }

  let checklist = null;
  if (authorization.globalRole === "group_admin" && process.env.DATABASE_URL) {
    const service = createOrchestrationService(process.env.DATABASE_URL);
    try {
      checklist = await service.pendingChecklist(authorization, requestId);
    } finally {
      await service.close();
    }
  }
  const labels: RequestRecordLabels = {
    actionKind: {
      assign_sku: history("actionAssignSku"),
      checklist: history("actionChecklist"),
      invite: history("actionInvite"),
      remove: history("actionRemove"),
      withdraw_invite: history("actionWithdrawInvite"),
    },
    actionMode: {
      automated: history("actionAutomated"),
      orchestration: history("actionOrchestration"),
    },
    actionStatus: {
      confirmed: history("actionConfirmed"),
      failed: history("actionFailed"),
      pending: history("actionPending"),
      sent: history("actionSent"),
      verification_failed: history("actionVerificationFailed"),
      withdrawn: history("actionWithdrawn"),
    },
    actions: history("actions"),
    actionsEmpty: history("actionsEmpty"),
    assignment: history("assignment"),
    assignmentActive: history("assignmentActive"),
    assignmentEmpty: history("assignmentEmpty"),
    assignmentEnded: history("assignmentEnded"),
    audit: history("audit"),
    auditEmpty: history("auditEmpty"),
    blockedBody: history("blockedBody"),
    blockedTitle: history("blockedTitle"),
    company: history("company"),
    closePayload: history("closePayload"),
    daysInState: history("daysInState"),
    decisionComment: history("decisionComment"),
    endedOn: history("endedOn"),
    failedBody: history("failedBody"),
    failedTitle: history("failedTitle"),
    failureReason: history("failureReason"),
    justification: history("justification"),
    kind: history("kind"),
    neededBy: history("neededBy"),
    noDate: history("noDate"),
    noPayloadResponse: history("noPayloadResponse"),
    organization: history("organization"),
    rawPayload: history("rawPayload"),
    rawRequest: history("rawRequest"),
    rawResponse: history("rawResponse"),
    request: history("request"),
    requestedBy: history("requestedBy"),
    resolvedAt: history("resolvedAt"),
    sentAt: history("sentAt"),
    startedOn: history("startedOn"),
    state: history("state"),
    stateHistory: history("stateHistory"),
    systemActor: history("systemActor"),
    vendorReference: history("vendorReference"),
    viewPools: history("viewPools"),
    viewRegister: history("viewRegister"),
  };
  const statusLabels = Object.fromEntries(
    REQUEST_STATUSES.map((requestStatus) => [
      requestStatus,
      status(requestStatus),
    ]),
  ) as Record<RequestStatus, string>;
  const checklistPanel = checklist ? (
    <ChecklistPanel
      action={checklist}
      confirmAction={confirmChecklistDone}
      labels={{
        cancel: orchestration("cancel"),
        confirm: orchestration("confirm"),
        confirmBody: orchestration("confirmBody"),
        confirmTitle: orchestration("confirmTitle"),
        failure: orchestration("failure"),
        failureError: orchestration("failureError"),
        failureLabel: orchestration("failureLabel"),
        failureTitle: orchestration("failureTitle"),
        genericError: orchestration("genericError"),
        step: {
          "connector.manual.open_vendor_console":
            orchestration("openConsole"),
          "connector.manual.invite_person": orchestration("invitePerson"),
          "connector.manual.assign_license": orchestration("assignLicense"),
          "connector.manual.remove_person": orchestration("removePerson"),
          "connector.manual.revoke_license": orchestration("revokeLicense"),
          "connector.manual.confirm_execution":
            orchestration("confirmExecution"),
        },
        submitting: orchestration("submitting"),
        title: orchestration("title"),
      }}
      notDoneAction={markChecklistNotDone}
    />
  ) : null;
  const feedback = (
    <RequestDetailFeedback
      created={query.created === "1"}
      labels={{
        success: intake("success"),
        unknownDomain: intake("unknownDomain"),
        missingRate: intake("missingRate"),
        budgetWarning: intake("budgetWarning"),
      }}
      locale={locale === "en-US" ? "en-US" : "es-EC"}
      warnings={record.warnings}
    />
  );
  const decisionActions = canDecideRequestDetail(
    authorization,
    record.company.id,
    record.state,
  ) ? (
    <RequestDetailDecision
      action={decideRequest}
      labels={{
        approve: approval("approve"),
        approveTitle: approval("approveTitle"),
        cancel: approval("cancel"),
        decisionError: approval("decisionError"),
        reject: approval("reject"),
        rejectionComment: approval("rejectionComment"),
        rejectionDescription: approval("rejectionDescription"),
        rejectionPlaceholder: approval("rejectionPlaceholder"),
        rejectionRequired: approval("rejectionRequired"),
        rejectionTitle: approval("rejectionTitle"),
        submitting: approval("submitting"),
      }}
      requestId={record.id}
    />
  ) : null;

  return (
    <main className="p-4 sm:p-6">
      <RequestRecord
        activeTab={activeTab(query.tab)}
        checklist={checklistPanel}
        decisionActions={decisionActions}
        feedback={feedback}
        isGroupAdmin={authorization.globalRole === "group_admin"}
        labels={labels}
        locale={locale === "en-US" ? "en-US" : "es-EC"}
        record={record}
        statusLabels={statusLabels}
      />
    </main>
  );
}
