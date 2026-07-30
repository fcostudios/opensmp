import type { parseObservation } from "./orchestration-contract";
import { createOrchestrationService } from "./orchestration";

export type MemberSyncChecklistObservation = ReturnType<
  typeof parseObservation
>;

/**
 * Production application port for US-019's future member-sync ingestion.
 *
 * The sync worker calls this port after it resolves a vendor member observation.
 * It is intentionally not exported through an HTTP route or server action.
 */
export function createMemberSyncChecklistObservationPort(
  connectionString: string,
) {
  const orchestration = createOrchestrationService(connectionString);
  return {
    close(): Promise<void> {
      return orchestration.close();
    },
    record(observation: MemberSyncChecklistObservation) {
      return orchestration.verifyChecklistObservation(observation);
    },
  };
}

export type MemberSyncChecklistObservationPort = ReturnType<
  typeof createMemberSyncChecklistObservationPort
>;
