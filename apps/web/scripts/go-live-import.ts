import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@smp/db/schema";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE_ROOT = resolve(REPO_ROOT, "data/imports/fixtures/us007");
const PRIVATE_ROOT = resolve(REPO_ROOT, "data/imports/private");
const RUNTIME_ENV_FILE = resolve(PRIVATE_ROOT, "us007.runtime.env");
const KEK_FILE = resolve(PRIVATE_ROOT, "us007.integration-credential.kek");
const MANIFEST_FILE = resolve(FIXTURE_ROOT, "credential-manifest.json");
const ROOT_ENV_FILE = resolve(REPO_ROOT, ".env");

const ACTOR = {
  id: "70070000-0000-4000-8000-000000000007",
  email: "us007.group-admin@ledger.invalid",
} as const;

type Mode = "init" | "preview" | "apply" | "verify";
type Database = ReturnType<typeof drizzle<typeof schema>>;

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseMode(value: string | undefined): Mode {
  if (
    value === "init" ||
    value === "preview" ||
    value === "apply" ||
    value === "verify"
  ) {
    return value;
  }
  throw new Error(
    "Usage: pnpm --filter smp-web import:go-live <init|preview|apply|verify>",
  );
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadRuntimeEnvironment(): Promise<void> {
  if (!(await pathExists(RUNTIME_ENV_FILE))) {
    throw new Error(`Runtime environment file is required: ${RUNTIME_ENV_FILE}`);
  }
  loadDotenv({ path: ROOT_ENV_FILE });
  const runtimeEnvironment = loadDotenv({
    path: RUNTIME_ENV_FILE,
    override: true,
  });
  if (runtimeEnvironment.error) {
    throw new Error(
      `Unable to load runtime environment file: ${RUNTIME_ENV_FILE}`,
    );
  }
  assertCondition(process.env.DATABASE_URL?.trim(), "DATABASE_URL is required");
}

async function readFixtureInput() {
  const [companiesCsv, membersCsv, capacityCsv] = await Promise.all([
    readFile(resolve(FIXTURE_ROOT, "companies.csv"), "utf8"),
    readFile(resolve(FIXTURE_ROOT, "member-backfill.csv"), "utf8"),
    readFile(resolve(FIXTURE_ROOT, "capacity.csv"), "utf8"),
  ]);
  return { companiesCsv, membersCsv, capacityCsv };
}

async function loadPreparedInput() {
  const boundary = await import(
    "../src/modules/org-registry/register-backfill-transaction"
  );
  const csvInput = await readFixtureInput();
  const prepared = await boundary.prepareProductionGoLiveImport(
    {
      ...csvInput,
      actorUserId: ACTOR.id,
    },
    process.env,
    { allowedKekRoot: PRIVATE_ROOT },
  );
  return { boundary, csvInput, prepared };
}

async function preview(database: Database): Promise<void> {
  const { boundary, prepared } = await loadPreparedInput();
  const report = await boundary.dryRunGoLiveImport(
    database,
    prepared,
    prepared.credentials,
    prepared.kek,
  );
  printJson({
    inserts: report.inserts,
    existing: report.existing,
    errors: report.errors,
  });
  assertCondition(report.errors.length === 0, "Preview validation failed");
}

async function applyImport(database: Database): Promise<void> {
  const { boundary, prepared } = await loadPreparedInput();
  const report = await boundary.dryRunGoLiveImport(
    database,
    prepared,
    prepared.credentials,
    prepared.kek,
  );
  assertCondition(
    report.errors.length === 0,
    "Apply refused because preview validation failed",
  );
  const { runLockedGoLiveOperatorImport } = await import(
    "../src/modules/org-registry/go-live-operator"
  );
  const result = await runLockedGoLiveOperatorImport(database, prepared, ACTOR);
  printJson({ created: result.created, reconciliation: result.reconciliation });
}

async function verifyImport(database: Database): Promise<void> {
  const csvInput = await readFixtureInput();
  const { verifyGoLiveFixture } = await import(
    "../src/modules/org-registry/go-live-operator"
  );
  printJson(await verifyGoLiveFixture(database, {
    csvInput,
    actorUserId: ACTOR.id,
    privateRoot: PRIVATE_ROOT,
    kekFile: KEK_FILE,
    environment: process.env,
  }));
}

async function run(): Promise<void> {
  const mode = parseMode(process.argv[2]);
  if (mode === "init") {
    const { initializePrivateMaterial } = await import(
      "../src/modules/org-registry/go-live-operator"
    );
    const created = await initializePrivateMaterial({
      privateRoot: PRIVATE_ROOT,
      runtimeEnvFile: RUNTIME_ENV_FILE,
      kekFile: KEK_FILE,
      manifestFile: MANIFEST_FILE,
    });
    process.stdout.write(`${created.runtimeEnvFile}\n${created.kekFile}\n`);
    return;
  }

  await loadRuntimeEnvironment();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const database = drizzle(pool, { schema });
    if (mode === "preview") {
      await preview(database);
    } else if (mode === "apply") {
      await applyImport(database);
    } else {
      await verifyImport(database);
    }
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown import error"}\n`,
  );
  process.exitCode = 1;
});
