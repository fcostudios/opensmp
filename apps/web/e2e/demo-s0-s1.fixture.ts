/**
 * CHG-118 — fictitious, clearly PROVISIONAL fixture for the S0/S1 demo dress
 * rehearsal. It only ever targets the disposable `ledger-demo-rehearsal`
 * Compose project started by infra/production/rehearse.sh with the
 * docker-compose.rehearsal-ports.yml override; it refuses the operator's
 * `ledger-production` project and its 18443 port.
 *
 * Only reference data (companies, people, one manual vendor/pool/seat,
 * user accounts and the Company Finance grant) is bootstrapped here. Register
 * assignments, the rate and the close are the journey under test.
 */
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const repositoryRoot = resolve(__dirname, "../../..");
export const demoProject = process.env.DEMO_REHEARSAL_PROJECT ?? "ledger-demo-rehearsal";
export const demoBaseUrl = process.env.DEMO_BASE_URL ?? "https://ledger.localhost:28443";
export const demoEnvFile = process.env.DEMO_REHEARSAL_ENV_FILE ?? "";
export const demoOverrideFile = resolve(
  repositoryRoot,
  "infra/production/docker-compose.rehearsal-ports.yml",
);
export const evidenceDir = resolve(__dirname, "../test-results/demo-s0-s1");
export const credentialsFile = resolve(evidenceDir, "rehearsal-users.json");

/** True only when a disposable demo stack was explicitly named. */
export const demoConfigured = demoEnvFile !== "" && existsSync(demoEnvFile);

export function assertDisposableTarget(): void {
  if (/^ledger-production($|-)/.test(demoProject)) {
    throw new Error(`Refusing ${demoProject}: the demo never targets the production project`);
  }
  if (new URL(demoBaseUrl).port === "18443") {
    throw new Error("Refusing port 18443: that is the localhost production stack");
  }
  if (!demoConfigured) throw new Error("DEMO_REHEARSAL_ENV_FILE must name the rehearsal runtime.env");
}

export function rehearsalEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(demoEnvFile, "utf8").split("\n")
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

const id = (suffix: string) => `11800000-0000-4000-8000-${suffix.padStart(12, "0")}`;
export const SYSTEM_USER = "00000000-0000-0000-0000-000000000001";
export const VENDOR_ID = id("901");
export const ACCOUNT = { id: id("902"), name: "PROVISIONAL Demo Pool" } as const;
export const LICENSE = { id: id("903"), name: "PROVISIONAL Demo Seat" } as const;
/** Provisional per-seat monthly rate (USD); not the contracted rate (OQ-SMP-4). */
export const PROVISIONAL_RATE_USD = "30.00";

export interface DemoCompany {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly people: readonly DemoPerson[];
}
export interface DemoPerson {
  readonly id: string;
  readonly name: string;
  /** Day of month M-1 the assignment starts (1 = full month). */
  readonly startDay: number;
  /** Inclusive end day within M-1, or null when the seat stays open. */
  readonly endDay: number | null;
}

const companyPlan: readonly { full: number; joinerDay?: number; leaverEndDay?: number }[] = [
  { full: 2 },
  { full: 2 },
  { full: 3 },
  { full: 3, joinerDay: 11 },
  { full: 4, leaverEndDay: 15 },
];

export const COMPANIES: readonly DemoCompany[] = companyPlan.map((plan, index) => {
  const n = index + 1;
  const people: DemoPerson[] = [];
  for (let p = 1; p <= plan.full; p += 1) {
    people.push({ id: id(`${n}0${p}`), name: `Provisional Person C${n}-${p}`, startDay: 1, endDay: null });
  }
  if (plan.joinerDay) {
    const p = plan.full + 1;
    people.push({ id: id(`${n}0${p}`), name: `Provisional Person C${n}-${p}`, startDay: plan.joinerDay, endDay: null });
  }
  if (plan.leaverEndDay) {
    const p = plan.full + 1;
    people.push({ id: id(`${n}0${p}`), name: `Provisional Person C${n}-${p}`, startDay: 1, endDay: plan.leaverEndDay });
  }
  return { id: id(`10${n}`), code: `PROV-DEMO-0${n}`, name: `PROVISIONAL Demo Company ${n}`, people };
});

export interface DemoUser {
  readonly key: "groupAdmin" | "centralFinance" | "companyFinance";
  readonly userAccountId: string;
  readonly username: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly globalRole: "group_admin" | "central_finance" | null;
  readonly platformAdmin: boolean;
  /** Company Finance grant (role `finance`) or null. */
  readonly financeCompanyId: string | null;
}

export const USERS: readonly DemoUser[] = [
  { key: "groupAdmin", userAccountId: id("801"), username: "demo-group-admin", email: "demo-group-admin@demo.ledger.invalid",
    firstName: "Demo", lastName: "Group Admin", globalRole: "group_admin", platformAdmin: true, financeCompanyId: null },
  { key: "centralFinance", userAccountId: id("802"), username: "demo-central-finance", email: "demo-central-finance@demo.ledger.invalid",
    firstName: "Demo", lastName: "Central Finance", globalRole: "central_finance", platformAdmin: true, financeCompanyId: null },
  { key: "companyFinance", userAccountId: id("803"), username: "demo-company-finance-01", email: "demo-company-finance-01@demo.ledger.invalid",
    firstName: "Demo", lastName: "Company Finance 01", globalRole: null, platformAdmin: false, financeCompanyId: COMPANIES[0]!.id },
];

/** Most recently completed calendar month in America/Guayaquil (M-1). */
export function previousMonth(now = new Date()): { period: string; from: string; to: string; days: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "America/Guayaquil", year: "numeric", month: "numeric" })
    .formatToParts(now).map((part) => [part.type, part.value]));
  const start = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 2, 1));
  const end = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, 0));
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return { period: iso(start).slice(0, 7), from: iso(start), to: iso(end), days: end.getUTCDate() };
}

export const day = (period: string, value: number) => `${period}-${String(value).padStart(2, "0")}`;

/**
 * Independent oracle (not the product's domain function): one rate segment per
 * person, amount = rate × days / month days, rounded half-up to the cent.
 */
export function expectedStatements(month: ReturnType<typeof previousMonth>) {
  const rateCents = BigInt(PROVISIONAL_RATE_USD.replace(".", ""));
  const usd = (cents: bigint) => `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
  const rows = COMPANIES.map((company) => {
    let cents = BigInt(0);
    let seatDays = 0;
    const lines = company.people.map((person) => {
      const last = person.endDay ?? month.days;
      const days = last - person.startDay + 1;
      const amount = (rateCents * BigInt(days) * BigInt(2) + BigInt(month.days)) / (BigInt(2) * BigInt(month.days));
      cents += amount;
      seatDays += days;
      return { person: person.name, days, amountUsd: usd(amount) };
    });
    return {
      code: company.code,
      companyId: company.id,
      totalUsd: usd(cents),
      totalCents: cents,
      seatDays,
      openingSeats: company.people.filter((person) => person.startDay === 1).length,
      monthEndHeadcount: company.people.filter((person) => person.endDay === null).length,
      peopleInMonth: company.people.length,
      lines,
    };
  });
  const groupCents = rows.reduce((sum, row) => sum + row.totalCents, BigInt(0));
  return { rows, groupTotalUsd: usd(groupCents) };
}

/** RFC 4180 parser sufficient for the register_v1 and statement CSV contracts. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") { cell += "\""; index += 1; }
      else if (character === "\"") quoted = false;
      else cell += character;
    } else if (character === "\"") quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export const cents = (amount: string) => {
  const [whole, fraction = ""] = amount.replace(/[$,\s]/g, "").split(".");
  return BigInt(whole!) * BigInt(100) + BigInt(fraction.padEnd(2, "0").slice(0, 2));
};

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replaceAll(" ", "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function composeArgs(): string[] {
  return ["compose", "--project-name", demoProject, "--env-file", demoEnvFile,
    "-f", resolve(repositoryRoot, "infra/docker-compose.production.yml"), "-f", demoOverrideFile];
}

export function psql(sql: string): string {
  return execFileSync("docker", [...composeArgs(), "exec", "-T", "postgres",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "ledger", "-At"], {
    cwd: repositoryRoot, encoding: "utf8", input: sql,
  });
}

/** Random per-run passwords; written only under the git-ignored test-results folder. */
export function generatePasswords(): Record<DemoUser["key"], string> {
  return Object.fromEntries(USERS.map((user) => [user.key, `Demo-${randomBytes(12).toString("hex")}`])) as Record<DemoUser["key"], string>;
}

const literal = (value: string | null) => value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;

export function bootstrapSql(): string {
  const companies = COMPANIES.map((company) => `(${literal(company.id)}, ${literal(company.name)}, ${literal(company.code)}, 'internal', 'active', 'en', now(), ${literal(SYSTEM_USER)})`).join(",\n  ");
  const people = COMPANIES.flatMap((company) => company.people.map((person) => {
    const email = `${person.name.toLowerCase().replaceAll(" ", ".")}@demo.ledger.invalid`;
    return `(${literal(person.id)}, ${literal(email)}, ${literal(person.name)}, ${literal(company.id)}, 'active', now(), ${literal(SYSTEM_USER)})`;
  })).join(",\n  ");
  const users = USERS.map((user) => `(${literal(user.userAccountId)}, ${literal(user.email)}, NULL, ${user.globalRole ? literal(user.globalRole) : "NULL"}, 'en', 'active', now())`).join(",\n  ");
  const grants = USERS.filter((user) => user.financeCompanyId).map((user, index) =>
    `(${literal(id(`85${index}`))}, ${literal(user.userAccountId)}, ${literal(user.financeCompanyId)}, 'finance', ${literal(`chg118-demo-finance-${index}`)}, now(), ${literal(SYSTEM_USER)})`).join(",\n  ");
  return `
BEGIN;
SET LOCAL ROLE ledger_owner;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM license_assignment) OR EXISTS (SELECT 1 FROM statement) OR EXISTS (SELECT 1 FROM rate_card) THEN
    RAISE EXCEPTION 'CHG-118 demo requires a fresh disposable rehearsal database (found assignments, statements or rates)';
  END IF;
END $$;
INSERT INTO company (id, name, code, type, status, statement_language, created_at, created_by) VALUES
  ${companies};
INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by) VALUES
  ${people};
INSERT INTO vendor (id, name, connector_type, provisioning_protocol, can_provision, can_deprovision, has_usage_data,
  has_cost_data, identity_matching, status, created_at, created_by) VALUES
  (${literal(VENDOR_ID)}, 'PROVISIONAL Demo Vendor', 'orchestration', 'none', false, false, false, false, 'email', 'active', now(), ${literal(SYSTEM_USER)});
INSERT INTO vendor_account (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by) VALUES
  (${literal(ACCOUNT.id)}, ${literal(VENDOR_ID)}, ${literal(ACCOUNT.name)}, 'orchestration', 1, 'active', now(), ${literal(SYSTEM_USER)});
INSERT INTO license_type (id, vendor_id, name, unit, status, created_at, created_by) VALUES
  (${literal(LICENSE.id)}, ${literal(VENDOR_ID)}, ${literal(LICENSE.name)}, 'seat', 'active', now(), ${literal(SYSTEM_USER)});
INSERT INTO vendor_account_capacity (id, vendor_account_id, license_type_id, purchased_qty, effective_from, note, created_at, created_by) VALUES
  (${literal(id("904"))}, ${literal(ACCOUNT.id)}, ${literal(LICENSE.id)}, 20, '2026-01-01', 'PROVISIONAL CHG-118 demo capacity', now(), ${literal(SYSTEM_USER)});
INSERT INTO user_account (id, email, idp_subject, global_role, ui_language, status, created_at) VALUES
  ${users};
INSERT INTO company_role_assignment (id, user_account_id, company_id, role, unique_grant, created_at, created_by) VALUES
  ${grants};
INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, company_id, note, before, after, occurred_at) VALUES
  (${literal(id("999"))}, ${literal(SYSTEM_USER)}, 'chg118.provisional_bootstrap', 'Company', ${literal(COMPANIES[0]!.id)}, NULL,
   'PROVISIONAL CHG-118 demo rehearsal fixture: fictitious companies, people and accounts; not real pilot data.',
   NULL, '{"companies":5,"people":${COMPANIES.reduce((sum, company) => sum + company.people.length, 0)},"provisional":true}'::jsonb, now());
COMMIT;
SELECT count(*) FROM company WHERE code LIKE 'PROV-DEMO-%';
`;
}
