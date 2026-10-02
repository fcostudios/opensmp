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
import { createAutomatedInviteDeliveryJob } from "./automated-invite-delivery.js";
import { createCapacityRecoveryJob } from "./capacity-recovery.js";
import { createAutomaticInvitationExpiryJob } from "./automatic-invitation-expiry.js";
import { createMembershipPollJob } from "./membership-poll.js";

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
  services?: {
    connectionString: string;
    credentialKekAllowedRoot?: string;
    credentialKekFile?: string;
    mailer?: NotificationMailer;
    now: () => Date;
    sleep: (milliseconds: number) => Promise<void>;
    transport: (request: Request) => Promise<Response>;
    workerId: string;
  },
): JobHandlers {
  return {
    analyticsSync: async () => dependencyNotDelivered("US-026"),
    memberSync: async () => dependencyNotDelivered("US-018"),
    invitePoll: async ({ at, vendorAccountId }) => {
      if (!services) return dependencyNotDelivered("US-063");
      const inviteDelivery = createAutomatedInviteDeliveryJob({
        allowedKekRoot: services.credentialKekAllowedRoot,
        connectionString: services.connectionString,
        kekFile: services.credentialKekFile,
        now: services.now,
        sleep: services.sleep,
        transport: services.transport,
      });
      const membershipPoll = createMembershipPollJob({
        allowedKekRoot: services.credentialKekAllowedRoot,
        connectionString: services.connectionString,
        kekFile: services.credentialKekFile,
        now: services.now,
        sleep: services.sleep,
        transport: services.transport,
      });
      const automaticExpiry = createAutomaticInvitationExpiryJob({
        allowedKekRoot: services.credentialKekAllowedRoot,
        connectionString: services.connectionString,
        kekFile: services.credentialKekFile,
        now: services.now,
        sleep: services.sleep,
        transport: services.transport,
      });
      try {
        const delivered = await inviteDelivery.drain({ at, vendorAccountId });
        const activated = await membershipPoll.drain({ at, vendorAccountId });
        const expired = await automaticExpiry.drain({ at, vendorAccountId });
        return successfulJob(delivered.processed + activated.processed + expired.processed);
      } finally {
        await Promise.allSettled([inviteDelivery.close(), membershipPoll.close(), automaticExpiry.close()]);
      }
    },
    alertEvaluation: async ({ at }) => {
      if (!services) return dependencyNotDelivered("US-042");
      const alertJob = createAlertEvaluationJob({ ...services, calendar });
      try {
        return await alertJob.run(at);
      } finally {
        await alertJob.close();
      }
    },
    closePrecheck: async ({ at }) =>
      isThirdBusinessDay(at, calendar) ? dependencyNotDelivered("US-034") : successfulJob(0),
    capacityRecovery: async ({ at }) => {
      if (!services) return dependencyNotDelivered("US-023");
      const job = createCapacityRecoveryJob({ connectionString: services.connectionString });
      try {
        const result = await job.drain(at);
        return successfulJob(result.processed);
      } finally {
        await job.close();
      }
    },
  };
}
