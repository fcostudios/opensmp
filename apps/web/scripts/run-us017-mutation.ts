import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import pg from "pg";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(import.meta.dirname, "../../..");
const composeFile = resolve(
  workspaceRoot,
  "infra/docker-compose.mailpit-test.yml",
);
const composeProject = "ledger_us017_mutation";

async function dropOrphanMutationDatabases(ownerUrl: string): Promise<void> {
  const maintenanceUrl = new URL(ownerUrl);
  maintenanceUrl.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const databases = await client.query<{ datname: string }>(
      `SELECT datname
       FROM pg_database
       WHERE datname LIKE 'ledger_us017_%'
       ORDER BY datname`,
    );
    for (const { datname } of databases.rows) {
      if (!/^ledger_us017_[a-f0-9]{32}$/.test(datname)) {
        throw new Error(`refusing to drop unexpected database ${datname}`);
      }
      await client.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [datname],
      );
      await client.query(`DROP DATABASE "${datname}"`);
    }
  } finally {
    await client.end();
  }
}

async function run(): Promise<number> {
  const fixture = await createPostgresFixture();
  try {
    await fixture.migrate();
    await execFileAsync(
      "docker",
      [
        "compose",
        "-p",
        composeProject,
        "-f",
        composeFile,
        "up",
        "-d",
        "--wait",
      ],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          MAILPIT_HTTP_PORT: "18027",
          MAILPIT_SMTP_PORT: "11027",
        },
      },
    );
    const child = spawn(
      "pnpm",
      [
        "exec",
        "stryker",
        "run",
        "stryker.us017.conf.json",
        ...process.argv.slice(2),
      ],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          MAILPIT_TEST_API_ORIGIN: "http://127.0.0.1:18027",
          MAILPIT_TEST_SMTP_URL: "smtp://127.0.0.1:11027",
          US017_MUTATION_DATABASE_ADMIN_URL: fixture.ownerUrl,
          US017_MUTATION_DATABASE_URL: fixture.appUrl,
        },
        stdio: "inherit",
      },
    );
    const [code, signal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    if (signal) throw new Error(`US-017 mutation runner ended by ${signal}`);
    return code ?? 1;
  } finally {
    await execFileAsync(
      "docker",
      [
        "compose",
        "-p",
        composeProject,
        "-f",
        composeFile,
        "down",
        "-v",
      ],
      { cwd: workspaceRoot },
    ).catch(() => undefined);
    try {
      await dropOrphanMutationDatabases(fixture.ownerUrl);
    } finally {
      await fixture.stop();
    }
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
