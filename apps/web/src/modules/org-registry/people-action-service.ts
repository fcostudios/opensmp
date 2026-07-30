import { revalidatePath } from "next/cache";

import {
  personInputSchema,
  startOffboardingInputSchema,
  type PersonInput,
} from "@smp/contracts";

import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import {
  PeopleRepositoryError,
  peopleRepository,
} from "./repository";
import {
  startOffboardingWithAuthorization,
  type StartOffboardingActionState,
} from "./people-action-core";

export interface PersonActionState {
  readonly ok: boolean;
  readonly personId?: string;
  readonly fastTrackRequestId?: string | null;
  readonly fastTrackRequestIds?: readonly string[];
  readonly reRequestHref?: string | null;
  readonly reRequestHrefs?: readonly string[];
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly globalError?: string;
}

export type PersonAction = (
  input: PersonInput,
) => Promise<PersonActionState>;

export type StartOffboardingAction = (
  input: unknown,
) => Promise<StartOffboardingActionState>;

function errorState(error: unknown): PersonActionState {
  if (error instanceof PeopleRepositoryError) {
    return { ok: false, globalError: error.code };
  }
  return { ok: false, globalError: "person_save_failed" };
}

export async function createPersonService(
  input: unknown,
): Promise<PersonActionState> {
  const parsed = personInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors,
      globalError: "person_validation_failed",
    };
  }
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization) {
    return { ok: false, globalError: "person_unauthorized" };
  }
  try {
    const saved = await peopleRepository.create(authorization, parsed.data);
    revalidatePath("/personas");
    return {
      ok: true,
      personId: saved.id,
      fastTrackRequestId: null,
      fastTrackRequestIds: [],
      reRequestHref: null,
      reRequestHrefs: [],
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function updatePersonService(
  input: unknown,
): Promise<PersonActionState> {
  const parsed = personInputSchema.safeParse(input);
  if (!parsed.success || !parsed.data.id) {
    return {
      ok: false,
      fieldErrors: parsed.success
        ? { id: ["Required"] }
        : parsed.error.flatten().fieldErrors,
      globalError: "person_validation_failed",
    };
  }
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization) {
    return { ok: false, globalError: "person_unauthorized" };
  }
  try {
    const saved = await peopleRepository.update(authorization, {
      ...parsed.data,
      id: parsed.data.id,
    });
    revalidatePath("/personas");
    revalidatePath(`/personas/${saved.person.id}`);
    for (const href of saved.reRequestHrefs) revalidatePath(href);
    return {
      ok: true,
      personId: saved.person.id,
      fastTrackRequestId: saved.fastTrackRequestId,
      fastTrackRequestIds: saved.fastTrackRequestIds,
      reRequestHref: saved.reRequestHref,
      reRequestHrefs: saved.reRequestHrefs,
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function startOffboardingService(
  input: unknown,
): Promise<StartOffboardingActionState> {
  const parsed = startOffboardingInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      globalError: "person_validation_failed",
    };
  }
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization) {
    return { ok: false, globalError: "person_unauthorized" };
  }
  const result = await startOffboardingWithAuthorization(
    peopleRepository,
    authorization,
    parsed.data,
  );
  if (result.ok) {
    revalidatePath("/personas");
    revalidatePath(`/personas/${result.personId}`);
  }
  return result;
}
