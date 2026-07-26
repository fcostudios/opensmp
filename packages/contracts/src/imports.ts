import { z } from "zod";

const companyHeaders = [
  "code",
  "name",
  "type",
  "approver_email",
  "finance_contact_email",
  "budget_monthly_usd",
  "statement_language",
] as const;
const memberHeaders = [
  "vendor_org_ref",
  "email",
  "full_name",
  "company_code",
  "license_type",
  "started_on",
] as const;
const capacityHeaders = [
  "vendor_org_ref",
  "license_type",
  "purchased_qty",
  "effective_from",
  "note",
] as const;

const credentialHeader = /(api.?key|admin.?key|analytics.?key|token|secret|password|credential)/i;
const isoDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "must be a valid YYYY-MM-DD date");
const email = z.string().trim().toLowerCase().email();
const nonEmpty = z.string().trim().min(1);

export const goLiveCsvInputSchema = z.object({
  companiesCsv: z.string().min(1).max(2_000_000),
  membersCsv: z.string().min(1).max(10_000_000),
  capacityCsv: z.string().min(1).max(2_000_000),
}).strict();
export type GoLiveCsvContractInput = z.infer<typeof goLiveCsvInputSchema>;

export interface CompanyImportRow {
  readonly code: string;
  readonly name: string;
  readonly type: "internal" | "external";
  readonly approverEmail: string;
  readonly financeContactEmail: string;
  readonly budgetMonthlyUsd: string | null;
  readonly statementLanguage: "es" | "en";
}

export interface MemberBackfillRow {
  readonly vendorOrgRef: string;
  readonly email: string;
  readonly fullName: string;
  readonly companyCode: string;
  readonly licenseType: string;
  readonly startedOn: string;
}

export interface CapacityImportRow {
  readonly vendorOrgRef: string;
  readonly licenseType: string;
  readonly purchasedQty: number;
  readonly effectiveFrom: string;
  readonly note: string | null;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if (character === "\n" && !quoted) {
      row.push(field.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("Malformed CSV: unterminated quoted field");
  row.push(field.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length === 0) throw new Error("CSV is empty");
  return rows;
}

function rowsFor(
  csv: string,
  expectedHeaders: readonly string[],
): Array<Record<string, string>> {
  const [headers, ...rows] = parseCsv(csv);
  const forbidden = headers.filter((header) => credentialHeader.test(header));
  if (forbidden.length > 0) {
    throw new Error(`Credential column is forbidden: ${forbidden.join(", ")}`);
  }
  if (
    headers.length !== expectedHeaders.length ||
    headers.some((header, index) => header !== expectedHeaders[index])
  ) {
    throw new Error(`CSV header must be exactly: ${expectedHeaders.join(",")}`);
  }
  return rows.map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function parseRows<T>(
  rows: Array<Record<string, string>>,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T[] {
  return rows.map((row, index) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`CSV row ${index + 2} ${issue.path.join(".")}: ${issue.message}`);
    }
    return parsed.data;
  });
}

function rejectDuplicates<T>(
  rows: readonly T[],
  selectors: ReadonlyArray<readonly [label: string, select: (row: T) => string]>,
): void {
  for (const [label, select] of selectors) {
    const seen = new Set<string>();
    for (const row of rows) {
      const value = select(row);
      if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
      seen.add(value);
    }
  }
}

export function parseCompaniesCsv(csv: string): CompanyImportRow[] {
  const schema = z.object({
    code: nonEmpty.transform((value) => value.toUpperCase()),
    name: nonEmpty,
    type: z.enum(["internal", "external"]),
    approver_email: email,
    finance_contact_email: email,
    budget_monthly_usd: z
      .string()
      .trim()
      .refine((value) => value === "" || /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value), "must be a non-negative USD amount")
      .transform((value) => value || null),
    statement_language: z.enum(["es", "en"]),
  }).transform((row) => ({
    code: row.code,
    name: row.name,
    type: row.type,
    approverEmail: row.approver_email,
    financeContactEmail: row.finance_contact_email,
    budgetMonthlyUsd: row.budget_monthly_usd,
    statementLanguage: row.statement_language,
  }));
  const parsed = parseRows(rowsFor(csv, companyHeaders), schema);
  rejectDuplicates(parsed, [
    ["company code", (row) => row.code],
    ["approver email", (row) => row.approverEmail],
    ["finance contact email", (row) => row.financeContactEmail],
  ]);
  const contactEmails = new Set<string>();
  for (const row of parsed) {
    for (const contactEmail of [
      row.approverEmail,
      row.financeContactEmail,
    ]) {
      if (contactEmails.has(contactEmail)) {
        throw new Error(`Duplicate contact email: ${contactEmail}`);
      }
      contactEmails.add(contactEmail);
    }
  }
  return parsed;
}

export function parseMemberBackfillCsv(csv: string): MemberBackfillRow[] {
  const schema = z.object({
    vendor_org_ref: nonEmpty,
    email,
    full_name: nonEmpty,
    company_code: nonEmpty.transform((value) => value.toUpperCase()),
    license_type: nonEmpty,
    started_on: isoDate,
  }).transform((row) => ({
    vendorOrgRef: row.vendor_org_ref,
    email: row.email,
    fullName: row.full_name,
    companyCode: row.company_code,
    licenseType: row.license_type,
    startedOn: row.started_on,
  }));
  const parsed = parseRows(rowsFor(csv, memberHeaders), schema);
  rejectDuplicates(parsed, [["member email", (row) => row.email]]);
  return parsed;
}

export function parseCapacityCsv(csv: string): CapacityImportRow[] {
  const schema = z.object({
    vendor_org_ref: nonEmpty,
    license_type: nonEmpty,
    purchased_qty: z.coerce.number().int().nonnegative(),
    effective_from: isoDate,
    note: z.string().trim().transform((value) => value || null),
  }).transform((row) => ({
    vendorOrgRef: row.vendor_org_ref,
    licenseType: row.license_type,
    purchasedQty: row.purchased_qty,
    effectiveFrom: row.effective_from,
    note: row.note,
  }));
  const parsed = parseRows(rowsFor(csv, capacityHeaders), schema);
  rejectDuplicates(parsed, [[
    "capacity effective key",
    (row) => `${row.vendorOrgRef}\u0000${row.licenseType}\u0000${row.effectiveFrom}`,
  ]]);
  return parsed;
}
