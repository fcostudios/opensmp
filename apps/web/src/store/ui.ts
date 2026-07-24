/**
 * Minimal UI store (Zustand). The canonical client-state pattern for
 * this app — co-locate feature stores beside this one under src/store.
 * Always expose a `reset()` so tests can `beforeEach(() => useUiStore.getState().reset())`.
 */
import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  reset: () => void;
}

const initialState = { sidebarOpen: true };

export const useUiStore = create<UiState>((set) => ({
  ...initialState,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  reset: () => set(initialState),
}));
