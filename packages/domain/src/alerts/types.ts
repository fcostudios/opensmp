import type {
  AlertEvaluation,
  AlertRuleContract,
  AlertSubjectRef,
  AlertType,
  NewAlertSubjectRef,
} from "@smp/contracts/alerts";

export type { AlertEvaluation, AlertRuleContract, AlertSubjectRef, AlertType, NewAlertSubjectRef };

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
