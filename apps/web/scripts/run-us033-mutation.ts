import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

import { createPostgresFixture } from "@smp/db/testing/postgres-container";

const workspaceRoot = resolve(import.meta.dirname, "../../..");

async function run(): Promise<number> {
  const fixture = await createPostgresFixture();

  try {
    await fixture.migrate();
    const child = spawn(
      "pnpm",
      ["exec", "stryker", "run", "stryker.us033.conf.json"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          US033_MUTATION_DATABASE_URL: fixture.appUrl,
          US033_MUTATION_DATABASE_ADMIN_URL: fixture.ownerUrl,
        },
        stdio: "inherit",
      },
    );
    const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    if (signal) {
      throw new Error(`US-033 mutation runner ended by signal ${signal}`);
    }
    return code ?? 1;
  } finally {
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
