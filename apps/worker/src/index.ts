import { pathToFileURL } from "node:url";
import type { EcuadorBusinessCalendar } from "@smp/domain";

import { createWorkerRuntime, type WorkerRuntime } from "./runtime.js";

export function createWorkerConnectionString(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;

  const url = new URL("postgresql://localhost");
  url.hostname = environment.PGHOST ?? "localhost";
  url.port = environment.PGPORT ?? "5432";
  url.username = environment.PGUSER ?? "postgres";
  url.password = environment.PGPASSWORD ?? "";
  url.pathname = `/${environment.PGDATABASE ?? "postgres"}`;
  return url.toString();
}

export function createEcuadorBusinessCalendar(value = process.env.ECUADOR_HOLIDAYS): EcuadorBusinessCalendar {
  if (!value?.trim()) {
    throw new TypeError("ECUADOR_HOLIDAYS is required for the close-precheck business calendar");
  }

  const holidays = new Set<string>();
  for (const holiday of value?.split(",") ?? []) {
    const date = holiday.trim();
    if (!date) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
      throw new TypeError("ECUADOR_HOLIDAYS entries must be valid YYYY-MM-DD dates");
    }
    holidays.add(date);
  }
  return { holidays };
}

async function main(): Promise<void> {
  let runtime: WorkerRuntime;
  runtime = createWorkerRuntime({
    calendar: createEcuadorBusinessCalendar(),
    connectionString: createWorkerConnectionString(),
    publicOrigin: process.env.LEDGER_PUBLIC_URL ?? process.env.PUBLIC_ORIGIN,
    smtpUrl: process.env.SMTP_URL,
    onFatalError: async () => {
      process.exitCode = 1;
      await runtime.stop();
    },
  });

  try {
    await runtime.start();
  } catch (error) {
    await runtime.stop();
    throw error;
  }
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
