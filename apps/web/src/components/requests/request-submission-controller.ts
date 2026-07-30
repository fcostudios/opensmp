"use client";

import {
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

import type { SubmitRequestInput } from "@smp/contracts";

import type { SubmitRequestActionState } from "@/modules/request-workflow/actions/submit-request";
import {
  nextRequestAttempt,
  requestInputFromForm,
  submissionAllowed,
  submissionSettlement,
  type RequestAttempt,
} from "./request-submission-client";

export type RequestExecutor = (
  input: unknown,
) => Promise<SubmitRequestActionState>;

export function useRequestSubmissionController({
  execute,
}: {
  readonly execute: RequestExecutor;
}) {
  const router = useRouter();
  const [requestFor, setRequestFor] =
    useState<SubmitRequestInput["requestFor"]>("self");
  const [result, setResult] = useState<SubmitRequestActionState>();
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const attemptRef = useRef<RequestAttempt | null>(null);
  const pendingRef = useRef(false);
  const succeededRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      pendingRef.current ||
      !submissionAllowed(succeededRef.current)
    ) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setResult(undefined);
    const semanticInput = requestInputFromForm(
      new FormData(event.currentTarget),
      requestFor,
    );
    const attempt = nextRequestAttempt(
      semanticInput,
      attemptRef.current,
      () => crypto.randomUUID(),
    );
    attemptRef.current = attempt;
    try {
      const next = await execute({
        ...semanticInput,
        clientRequestId: attempt.clientRequestId,
      });
      setResult(next);
      const settlement = submissionSettlement(next);
      succeededRef.current = settlement.succeeded;
      setSucceeded(settlement.succeeded);
      if (settlement.destination) {
        router.push(settlement.destination);
      }
    } catch {
      setResult({ ok: false, error: "submission_failed" });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return {
    pending,
    requestFor,
    result,
    setRequestFor,
    submit,
    succeeded,
  };
}
