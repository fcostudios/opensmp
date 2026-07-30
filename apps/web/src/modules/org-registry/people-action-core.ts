import type { StartOffboardingInput } from "@smp/contracts";

import type { LedgerAuthorization } from "../identity-access/authorization";
import {
  PeopleRepositoryError,
  type PeopleRepository,
} from "./repository";

export interface StartOffboardingActionState {
  readonly ok: boolean;
  readonly personId?: string;
  readonly status?: "offboarding";
  readonly affectedRequestIds?: readonly string[];
  readonly provisioningActionIds?: readonly string[];
  readonly globalError?: string;
}

export async function startOffboardingWithAuthorization(
  repository: PeopleRepository,
  authorization: LedgerAuthorization,
  input: StartOffboardingInput,
  occurredAt?: Date,
): Promise<StartOffboardingActionState> {
  try {
    const saved = await repository.startOffboarding(
      authorization,
      input,
      occurredAt,
    );
    return {
      ok: true,
      personId: saved.person.id,
      status: saved.status,
      affectedRequestIds: saved.affectedRequestIds,
      provisioningActionIds: saved.provisioningActionIds,
    };
  } catch (error) {
    if (error instanceof PeopleRepositoryError) {
      return { ok: false, globalError: error.code };
    }
    return { ok: false, globalError: "person_offboarding_failed" };
  }
}
