import { spawn } from "node:child_process";

import setup from "./postgres-cluster-global-setup";

// CHG-067 — `tsx run-with-shared-postgres.ts <command> [...args]` runs a test
// command inside one shared PostgreSQL 16 cluster (see setup), so a suite whose
// files run in parallel starts one container instead of one per file. A killed
// run leaves the cluster to Ryuk.
async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error("usage: run-with-shared-postgres <command> [...args]");
  const teardown = await setup();
  try {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
    return await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  } finally {
    await teardown?.();
  }
}

main().then((code) => process.exit(code), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
