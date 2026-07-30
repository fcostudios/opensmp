import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import pg from "pg";

const workspaceRoot = resolve(import.meta.dirname, "../../..");

async function dropWorkerDatabases(ownerUrl: string): Promise<void> {
  const maintenanceUrl = new URL(ownerUrl);
  maintenanceUrl.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const databases = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database
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
    for (const config of ["stryker.us042-surfaces.conf.json"]) {
      const child = spawn(
        "pnpm",
        ["exec", "stryker", "run", config, ...process.argv.slice(2)],
        {
          cwd: workspaceRoot,
          env: {
            ...process.env,
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
      if (signal) throw new Error(`US-042 mutation runner ended by ${signal}`);
      if (code !== 0) return code ?? 1;
    }
    const probe = spawn(
      "pnpm",
      [
        "--filter",
        "smp-web",
        "exec",
        "tsx",
        "scripts/run-us042-alert-read-mutation-probe.ts",
      ],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          US017_MUTATION_DATABASE_ADMIN_URL: fixture.ownerUrl,
          US017_MUTATION_DATABASE_URL: fixture.appUrl,
        },
        stdio: "inherit",
      },
    );
    const [probeCode, probeSignal] = (await once(probe, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    if (probeSignal) {
      throw new Error(`US-042 alert mutation probe ended by ${probeSignal}`);
    }
    if (probeCode !== 0) return probeCode ?? 1;
    return 0;
  } finally {
    try {
      await dropWorkerDatabases(fixture.ownerUrl);
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
