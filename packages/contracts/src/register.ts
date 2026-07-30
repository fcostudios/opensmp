import { z } from "zod";

export interface RegisterFilters {
  readonly companyId?: string;
  readonly cursor?: string;
  readonly endDate?: string;
  readonly endReason?: "left_company" | "inactive" | "reallocated";
  readonly licenseTypeId?: string;
  readonly limit?: number;
  readonly openState?: "open" | "closed";
  readonly personId?: string;
  readonly sourceKind?: "request" | "import" | "reconciliation";
  readonly sourceRequestNo?: string;
  readonly startDate?: string;
  readonly vendorAccountId?: string;
}

export function createRegisterFiltersSchema() {
  const dateFilter = z
    .string()
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    });
  const optionalUuid = z.string().uuid().optional();

  return z.object({
    companyId: optionalUuid,
    cursor: z.string().min(1).max(500).optional(),
    endDate: dateFilter.optional(),
    endReason: z.enum(["left_company", "inactive", "reallocated"]).optional(),
    licenseTypeId: optionalUuid,
    limit: z.coerce.number().int().min(1).max(100).optional(),
    openState: z.enum(["open", "closed"]).optional(),
    personId: optionalUuid,
    sourceKind: z.enum(["request", "import", "reconciliation"]).optional(),
    sourceRequestNo: z.string().trim().min(1).max(200).optional(),
    startDate: dateFilter.optional(),
    vendorAccountId: optionalUuid,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.startDate || !value.endDate) return;
    if (value.startDate <= value.endDate) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startDate must not be after endDate",
      path: ["endDate"],
    });
  });
}

/** Parses URL/form filters once and rejects duplicate or unrecognized keys. */
export function parseRegisterFilters(input: unknown): RegisterFilters {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid register filters");
  }
  const normalized = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = createRegisterFiltersSchema().safeParse(normalized);
  if (!result.success) throw new Error("Invalid register filters");
  return result.data;
}

/** Canonical query serialization is shared by the page, action, and download route. */
export function serializeRegisterFilters(filters: RegisterFilters): string {
  const parameters = new URLSearchParams();
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key as keyof RegisterFilters];
    if (value !== undefined) parameters.set(key, String(value));
  }
  return parameters.toString();
}
