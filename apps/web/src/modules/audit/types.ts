import { z } from "zod";

export const AUDIT_TIME_ZONE = "America/Guayaquil";

export interface AuditFilters {
  readonly action?: string;
  readonly actor?: string;
  readonly cursor?: string;
  readonly endDate?: string;
  readonly entityType?: string;
  readonly startDate?: string;
}

export interface AuditListItem {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityHref: string | null;
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly companyCode: string | null;
  readonly note: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly occurredAt: string;
}

export interface AuditListPage {
  readonly items: readonly AuditListItem[];
  readonly nextCursor: string | null;
}

const dateFilter = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)));

const auditFiltersSchema = z.object({
  action: z.string().min(1).max(100).optional(),
  actor: z.union([z.literal("system"), z.string().uuid()]).optional(),
  cursor: z.string().min(1).max(500).optional(),
  endDate: dateFilter.optional(),
  entityType: z.string().min(1).max(100).optional(),
  startDate: dateFilter.optional(),
});

export function parseAuditFilters(
  input: Readonly<Record<string, string | string[] | undefined>>,
): AuditFilters {
  const normalized = Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ])
      .filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = auditFiltersSchema.safeParse(normalized);
  if (!result.success) throw new Error("Invalid audit filters");
  return result.data;
}
