import type {
  AlertEvaluation,
  AlertRuleContract,
  AlertSubjectRef,
  AlertType,
} from "@smp/contracts/alerts";

export type { AlertEvaluation, AlertRuleContract, AlertSubjectRef, AlertType };

export type AlertFacts = {
  ageHours?: number;
  ageMinutes?: number;
  businessDaysElapsed?: number;
  deadlineExceeded?: boolean;
  drifted?: boolean;
  failed?: boolean;
  free?: number;
  lowPoolFloor?: number;
  subject: AlertSubjectRef;
};
