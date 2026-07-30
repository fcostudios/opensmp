import type { DecideRequestInput } from "@smp/contracts";

export interface ApprovalQueueLabels {
  readonly agingHours: string;
  readonly approve: string;
  readonly approveCost: string;
  readonly approveDescription: string;
  readonly approveProjected: string;
  readonly approveTitle: string;
  readonly budgetHeadroom: string;
  readonly cancel: string;
  readonly company: string;
  readonly committedCost: string;
  readonly createdAt: string;
  readonly decisionError: string;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly headroomUnavailable: string;
  readonly availableOf: string;
  readonly justification: string;
  readonly license: string;
  readonly missingRate: string;
  readonly monthlyCost: string;
  readonly neededBy: string;
  readonly organization: string;
  readonly pendingApproval: string;
  readonly reject: string;
  readonly rejectionComment: string;
  readonly rejectionDescription: string;
  readonly rejectionPlaceholder: string;
  readonly rejectionRequired: string;
  readonly rejectionTitle: string;
  readonly state: string;
  readonly submitting: string;
  readonly successApproved: string;
  readonly successRejected: string;
}

export type DecideRequestActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export type DecideRequestAction = (
  input: DecideRequestInput,
) => Promise<DecideRequestActionResult>;
