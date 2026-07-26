import {
  dependencyNotDelivered,
  isThirdBusinessDay,
  successfulJob,
  type EcuadorBusinessCalendar,
  type JobResult,
  type JobName,
} from "@smp/domain";

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
): JobHandlers {
  return {
    analyticsSync: async () => dependencyNotDelivered("US-026"),
    memberSync: async () => dependencyNotDelivered("US-018"),
    invitePoll: async () => dependencyNotDelivered("US-018"),
    alertEvaluation: async () => dependencyNotDelivered("US-042"),
    closePrecheck: async ({ at }) =>
      isThirdBusinessDay(at, calendar) ? dependencyNotDelivered("US-034") : successfulJob(0),
  };
}
