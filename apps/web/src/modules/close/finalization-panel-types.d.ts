import type { FinalizeActionState } from "@smp/contracts/close";
export type FinalizeAction = (state: FinalizeActionState, form: FormData) => Promise<FinalizeActionState>;
export type StatementSummary = { id: string; companyName: string; status: "draft" | "final" | "reconciled" };
