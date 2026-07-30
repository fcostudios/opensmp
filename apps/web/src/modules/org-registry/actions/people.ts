"use server";

import {
  createPersonService,
  startOffboardingService,
  updatePersonService,
} from "../people-action-service";

/**
 * @read-only-action The action wrapper itself only validates/dispatches through
 * peopleActionService; every database mutation is enclosed by the repository's
 * canonical withAudit transaction.
 */
export async function createPerson(input: unknown) {
  return createPersonService(input);
}

/**
 * @read-only-action The action wrapper itself only validates/dispatches through
 * peopleActionService; every database mutation is enclosed by the repository's
 * canonical withAudit transaction.
 */
export async function updatePerson(input: unknown) {
  return updatePersonService(input);
}

/**
 * @read-only-action This wrapper dispatches to a repository mutation enclosed
 * by the canonical withAudit transaction.
 */
export async function startOffboarding(input: unknown) {
  return startOffboardingService(input);
}

export type {
  PersonAction,
  PersonActionState,
  StartOffboardingAction,
} from "../people-action-service";
export type { StartOffboardingActionState } from "../people-action-core";
