import {
  dependencyNotDelivered,
  isThirdBusinessDay,
  successfulJob,
  type EcuadorBusinessCalendar,
  type JobResult,
  type JobName,
} from "@smp/domain";
import type { NotificationMailer } from "@smp/notifications";

import { createAlertEvaluationJob } from "../alerts/evaluate-alerts.js";

export type WorkerJobContext = {
  at: Date;
  idempotencyKey: string;
  jobId: string;
  jobName: JobName;
  vendorAccountId?: string;
};

export type JobHandlers = Record<JobName, (context: WorkerJobContext) => Promise<JobResult>>;

export function createDeferredJobHandlers(
  calendar: EcuadorBusinessCalendar = { holidays: new Set() },
  alerts?: {
    connectionString: string;
    mailer?: NotificationMailer;
    workerId: string;
  },
): JobHandlers {
  return {
    analyticsSync: async () => dependencyNotDelivered("US-026"),
    memberSync: async () => dependencyNotDelivered("US-018"),
    invitePoll: async () => dependencyNotDelivered("US-018"),
    alertEvaluation: async ({ at }) => {
      if (!alerts) return dependencyNotDelivered("US-042");
      const alertJob = createAlertEvaluationJob({ ...alerts, calendar });
      try {
        return await alertJob.run(at);
      } finally {
        await alertJob.close();
      }
    },
    closePrecheck: async ({ at }) =>
      isThirdBusinessDay(at, calendar) ? dependencyNotDelivered("US-034") : successfulJob(0),
  };
}
