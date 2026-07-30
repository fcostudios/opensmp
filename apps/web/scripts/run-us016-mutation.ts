import { execFile } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

import { createPostgresFixture } from "@smp/db/testing/postgres-container";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(import.meta.dirname, "../../..");
const composeFile = resolve(
  workspaceRoot,
  "infra/docker-compose.mailpit-test.yml",
);
const composeProject = "ledger_us016_mutation";

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
          MAILPIT_HTTP_PORT: "18026",
          MAILPIT_SMTP_PORT: "11026",
        },
      },
    );
    const child = spawn(
      "pnpm",
      [
        "exec",
        "stryker",
        "run",
        "stryker.us016.conf.json",
        ...process.argv.slice(2),
      ],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          MAILPIT_TEST_API_ORIGIN: "http://127.0.0.1:18026",
          MAILPIT_TEST_SMTP_URL: "smtp://127.0.0.1:11026",
          US016_MUTATION_DATABASE_ADMIN_URL: fixture.ownerUrl,
          US016_MUTATION_DATABASE_URL: fixture.appUrl,
        },
        stdio: "inherit",
      },
    );
    const [code, signal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    if (signal) throw new Error(`US-016 mutation runner ended by ${signal}`);
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
    await fixture.stop();
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
