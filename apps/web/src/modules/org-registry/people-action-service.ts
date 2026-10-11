import { z } from "zod";

import { revalidatePath } from "next/cache";

import {
  personInputSchema,
  startOffboardingInputSchema,
  type PersonInput,
} from "@smp/contracts";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import {
  PeopleRepositoryError,
  peopleRepository,
  type PeopleRepository,
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

export interface OffboardingActionResponse extends StartOffboardingActionState {
  readonly targets?: readonly { readonly requestId: string; readonly label: string }[];
}

export type StartOffboardingAction = (
  input: unknown,
) => Promise<OffboardingActionResponse>;

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

/** Production target validation shared by the action and its real-DB oracle. */
export function safeParseOffboardingTarget(input: unknown) {
  return startOffboardingInputSchema.extend({ requestId: z.string().uuid().optional() }).safeParse(input);
}

/** The production intent executor; reads and rejections never invalidate mutation views. */
export async function executeOffboardingIntent(
  repository: PeopleRepository,
  authorization: LedgerAuthorization | null,
  input: unknown,
  occurredAt?: Date,
): Promise<{ readonly state: OffboardingActionResponse; readonly invalidationPaths: readonly string[] }> {
  if (!authorization) return {state:{ok:false,globalError:"person_unauthorized"},invalidationPaths:[]};
  if (authorization.globalRole !== "group_admin") {
    return { state: { ok: false, globalError: "person_forbidden" }, invalidationPaths: [] };
  }
  const hasIntent = typeof input === "object" && input !== null && Object.prototype.hasOwnProperty.call(input, "intent");
  const read = z.object({ intent: z.literal("read_targets"), personId: z.string().uuid() }).strict().safeParse(input);
  if (hasIntent) {
    if (!read.success) return { state: { ok: false, globalError: "person_validation_failed" }, invalidationPaths: [] };
    try {
      const detail = await repository.detail(authorization, read.data.personId);
      const targets = new Map<string, { requestId: string; label: string }>();
      for (const assignment of detail.assignmentHistory) {
        if (assignment.endedOn !== null || assignment.sourceRequestState !== "active" || !assignment.sourceRequestId) continue;
        targets.set(assignment.sourceRequestId, { requestId: assignment.sourceRequestId, label: `${assignment.vendorAccountName} · ${assignment.licenseTypeName}` });
      }
      return { state: { ok: true, personId: detail.id, targets: [...targets.values()] }, invalidationPaths: [] };
    } catch (error) {
      return { state: { ok: false, globalError: error instanceof PeopleRepositoryError ? error.code : "person_offboarding_failed" }, invalidationPaths: [] };
    }
  }
  const parsed = safeParseOffboardingTarget(input);
  if (!parsed.success) return { state: { ok: false, globalError: "person_validation_failed" }, invalidationPaths: [] };
  const state = await startOffboardingWithAuthorization(repository, authorization, parsed.data, occurredAt);
  return {
    state,
    invalidationPaths: state.ok ? ["/personas", `/personas/${state.personId}`, ...(state.affectedRequestIds ?? []).map(requestId => `/solicitudes/${requestId}`)] : [],
  };
}

export async function startOffboardingService(input: unknown): Promise<OffboardingActionResponse> {
  const authorization = await loadCurrentLedgerAuthorization();
  const result = await executeOffboardingIntent(peopleRepository, authorization, input);
  for (const path of result.invalidationPaths) revalidatePath(path);
  return result.state;
}
