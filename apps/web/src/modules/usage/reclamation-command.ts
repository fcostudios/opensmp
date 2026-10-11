import { z } from "zod";

export type ReclamationCommand = Readonly<{ person_ids: readonly string[]; company_id?: string; note?: string; client_request_id: string }>;
export type ReclamationCounts = Readonly<{ created: number; existing: number }>;
export type ReclamationResult = ({ readonly status: "success" } & ReclamationCounts) | { readonly status: "error"; readonly code: "invalid_input" | "access_denied" | "selection_changed" | "unexpected" };
export type ReclamationAction = (input: unknown) => Promise<ReclamationResult>;
const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const reclamationCommandSchema = z.object({
  person_ids: z.array(uuid).transform(values => [...new Set(values)]).pipe(z.array(z.string()).min(1).max(50)),
  company_id: uuid.optional(),
  note: z.string().max(2000).optional().transform(value => value?.trim() || null),
  client_request_id: uuid,
}).strict();
export type ParsedReclamationCommand = z.output<typeof reclamationCommandSchema>;
export function parseReclamationCommand(input: unknown): ParsedReclamationCommand { return reclamationCommandSchema.parse(input); }
