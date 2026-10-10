import { z } from "zod";
import type { InactivityWindow } from "@smp/domain/usage/inactivity";
export type UsageFilters = Readonly<{ companyId?: string; window: InactivityWindow; cursor?: string }>;
export class UsageReadError extends Error {
  constructor(readonly code: "access_denied" | "invalid_filter" | "invalid_cursor") { super(code); }
}
export function parseUsageFilters(parameters: Record<string, string | string[] | undefined>): UsageFilters {
  const query = z.object({
    companyId: z.string().uuid().optional(),
    window: z.enum(["30", "60", "90"]).default("30"),
    cursor: z.string().min(1).max(2048).optional(),
  });
  const parsed = query.safeParse({ companyId: parameters.companyId === "" ? undefined : parameters.companyId, window: parameters.window, cursor: parameters.cursor });
  if (!parsed.success) throw new UsageReadError("invalid_filter");
  const value = parsed.data;
  return { window: Number(value.window) as InactivityWindow, ...(value.companyId ? { companyId: value.companyId } : {}), ...(value.cursor ? { cursor: value.cursor } : {}) };
}
export function serializeUsageFilters(filters: UsageFilters): Record<string, string> {
  return { window: String(filters.window), ...(filters.companyId ? { companyId: filters.companyId } : {}), ...(filters.cursor ? { cursor: filters.cursor } : {}) };
}
