// Core domain — typed service boundary (DoR stub; operation
// bodies are dev-team work). Consumes @smp/contracts + @smp/db.
export interface CoreService {
  readonly context: "core";
}

export const createCoreService = (): CoreService => ({ context: "core" });
