import { createStore } from "zustand/vanilla";
import { parseReclamationCommand, type ParsedReclamationCommand, type ReclamationResult } from "../../modules/usage/reclamation-command";

type Submission = { command: ParsedReclamationCommand; generation: number };
type State = {
  selectedPersonIds: string[]; note: string; open: boolean; submitting: boolean;
  requestId: string | null; result: ReclamationResult | null; generation: number;
  togglePerson(id: string): void; setNote(note: string): void;
  openDialog(): void; closeDialog(): void; reset(): void;
  beginSubmission(companyId: string | undefined, requestId: () => string): Submission | null;
  finishSubmission(submission: Submission, result: ReclamationResult): void;
};
export function createReclamationSelectionStore() {
  return createStore<State>((set, get) => ({
    selectedPersonIds: [], note: "", open: false, submitting: false, requestId: null, result: null, generation: 0,
    togglePerson(id) {
      const state = get();
      if (state.submitting || state.open) return;
      set({ selectedPersonIds: state.selectedPersonIds.includes(id) ? state.selectedPersonIds.filter(value => value !== id) : [...state.selectedPersonIds, id], requestId: null, result: null });
    },
    setNote(note) { if (!get().submitting && get().result?.status !== "success") set({ note, requestId: null, result: null }); },
    openDialog() { if (!get().submitting && !get().open && get().selectedPersonIds.length > 0) set({ open: true, result: null }); },
    closeDialog() {
      const state = get();
      if (state.submitting) return;
      set({ open: false, note: "", requestId: null, result: null, generation: state.generation + 1,
        selectedPersonIds: state.result?.status === "success" ? [] : state.selectedPersonIds });
    },
    reset() { set({ selectedPersonIds: [], note: "", open: false, submitting: false, requestId: null, result: null, generation: get().generation + 1 }); },
    beginSubmission(companyId, requestId) {
      const state = get();
      if (!state.open || state.submitting || state.result?.status === "success") return null;
      try {
        const candidate = state.requestId ?? requestId();
        const command = parseReclamationCommand({ person_ids: state.selectedPersonIds, company_id: companyId, note: state.note, client_request_id: candidate });
        set({ submitting: true, requestId: command.client_request_id, result: null });
        return { command, generation: state.generation };
      } catch { set({ result: { status: "error", code: "invalid_input" } }); return null; }
    },
    finishSubmission(submission, result) {
      const state = get();
      if (submission.generation !== state.generation || submission.command.client_request_id !== state.requestId) return;
      set({ submitting: false, result });
    },
  }));
}
