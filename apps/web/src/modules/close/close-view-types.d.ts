import type { CloseActionState } from "@smp/contracts/close";
export type CloseAction = (state: CloseActionState, form: FormData) => Promise<CloseActionState>;
export interface CloseRunView { id: string; period: string; status: "running" | "succeeded" | "failed"; note: string | null; startedAt: Date; finishedAt: Date | null; triggeredByName?: string | null; scheduled?: boolean | null }

export interface CloseSummary {generated:number;drafts:number;finals:number;totalUsd:string;companies:number}
