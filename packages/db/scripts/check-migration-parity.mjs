import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { applyMigrations } from "./apply-migrations.mjs";
import { verifyMigratedSchema } from "./verify-schema.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function quotedIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrl(adminUrl, databaseName) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function redactOutput(output, redactions) {
  let redacted = output.replace(
    /postgres(?:ql)?:\/\/[^\s'"]+/giu,
    "postgresql://[REDACTED]",
  );
  for (const value of [...redactions].filter(Boolean).sort(
    (left, right) => right.length - left.length,
  )) {
    redacted = redacted.replaceAll(value, "[REDACTED]");
  }
  return redacted;
}

function boundedOutput(output, maxOutputBytes, wasTruncated) {
  const marker = "\n[output truncated]";
  const outputBuffer = Buffer.from(output);
  if (!wasTruncated && outputBuffer.length <= maxOutputBytes) {
    return output.trim();
  }
  const markerBuffer = Buffer.from(marker);
  const contentLimit = Math.max(0, maxOutputBytes - markerBuffer.length);
  return (
    outputBuffer.subarray(0, contentLimit).toString("utf8").trimEnd() +
    marker
  ).trim();
}

async function terminateWindowsProcessTree(pid) {
  await new Promise((resolveTermination, rejectTermination) => {
    const terminator = spawn(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      {
        windowsHide: true,
        stdio: "ignore",
      },
    );
    terminator.once("error", rejectTermination);
    terminator.once("close", (code) => {
      if (code === 0) {
        resolveTermination();
      } else {
        rejectTermination(
          new Error(`taskkill failed for process tree ${pid} with exit ${code}`),
        );
      }
    });
  });
}

async function terminateProcessTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await terminateWindowsProcessTree(child.pid);
    return;
  }
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    // The group may already be gone; fall back to the direct child.
  }
  try {
    child.kill(signal);
  } catch {
    // The process already exited.
  }
}

export function resolvePnpmInvocation(
  args,
  {
    env = process.env,
    platform = process.platform,
    execPath = process.execPath,
  } = {},
) {
  const packageManagerCli = env.npm_execpath;
  if (
    packageManagerCli &&
    basename(packageManagerCli).toLowerCase().includes("pnpm")
  ) {
    return {
      command: execPath,
      args: [packageManagerCli, ...args],
    };
  }
  return {
    command: platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
  };
}

function processError(message, terminationErrors) {
  const primary = new Error(message);
  if (terminationErrors.length === 0) return primary;
  return new AggregateError(
    [primary, ...terminationErrors],
    "child process failed and process-tree cleanup also failed",
  );
}

function redactionCaptureLimit(maxOutputBytes, redactions) {
  const longestKnownSecret = redactions.reduce(
    (longest, value) =>
      Math.max(longest, value ? Buffer.byteLength(value) : 0),
    0,
  );
  return maxOutputBytes + longestKnownSecret + 4_096;
}

/*
 * Capture beyond the final display cap so a secret beginning immediately
 * before that cap is complete when redaction runs. The redacted text is then
 * byte-capped for the error surface.
 */
function outputCollector(maxOutputBytes, redactions) {
  const chunks = [];
  const captureLimit = redactionCaptureLimit(maxOutputBytes, redactions);
  let capturedBytes = 0;
  let truncated = false;
  return {
    capture(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, captureLimit - capturedBytes);
      if (remaining > 0) {
        chunks.push(buffer.subarray(0, remaining));
        capturedBytes += Math.min(buffer.length, remaining);
      }
      if (buffer.length > remaining) truncated = true;
    },
    output() {
      const rawOutput = Buffer.concat(chunks).toString("utf8");
      const redacted = redactOutput(rawOutput, redactions);
      return boundedOutput(
        redacted,
        maxOutputBytes,
        truncated || Buffer.byteLength(rawOutput) > maxOutputBytes,
      );
    },
  };
}

export async function runBoundedProcess(
  command,
  args,
  {
    cwd = packageRoot,
    env = process.env,
    timeoutMs = 120_000,
    killGraceMs = 1_000,
    maxOutputBytes = 64 * 1024,
    redactions = [],
  } = {},
) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collector = outputCollector(maxOutputBytes, redactions);
    const terminationErrors = [];
    let timedOut = false;
    let spawnError;
    let killTimer;
    let terminationPromise = Promise.resolve();

    child.stdout.on("data", collector.capture);
    child.stderr.on("data", collector.capture);
    child.once("error", (error) => {
      spawnError = error;
    });

    const terminate = async (signal) => {
      try {
        await terminateProcessTree(child, signal);
      } catch (error) {
        terminationErrors.push(
          new Error(`process-tree termination failed: ${error.message}`, {
            cause: error,
          }),
        );
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminationPromise = terminate("SIGTERM");
      if (process.platform !== "win32") {
        killTimer = setTimeout(() => {
          terminationPromise = terminationPromise.then(() =>
            terminate("SIGKILL"),
          );
        }, killGraceMs);
        killTimer.unref();
      }
    }, timeoutMs);
    timeout.unref();

    child.once("close", async (code, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      await terminationPromise;
      const output = collector.output();
      if (spawnError) {
        rejectRun(
          new Error(
            `failed to start ${command}: ${redactOutput(spawnError.message, redactions)}`,
            { cause: spawnError },
          ),
        );
      } else if (timedOut) {
        rejectRun(
          processError(
            `${command} timed out after ${timeoutMs}ms` +
              (output ? `: ${output}` : ""),
            terminationErrors,
          ),
        );
      } else if (code !== 0) {
        rejectRun(
          new Error(
            `${command} failed with exit ${code ?? `signal ${signal}`}` +
              (output ? `: ${output}` : ""),
          ),
        );
      } else {
        resolveRun({ stdout: output });
      }
    });
  });
}

function configuredPushTimeout() {
  const timeout = Number(process.env.DRIZZLE_PUSH_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000;
}

async function runDrizzlePush(pushUrl, { dotenvDirectory } = {}) {
  const password = new URL(pushUrl).password;
  const invocation = resolvePnpmInvocation([
    "exec",
    "drizzle-kit",
    "push",
    "--force",
  ]);
  await runBoundedProcess(
    invocation.command,
    invocation.args,
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        DATABASE_URL: pushUrl,
        DB_DRIVER: "pg",
        ...(dotenvDirectory
          ? { DRIZZLE_ENV_DIR: dotenvDirectory }
          : {}),
      },
      timeoutMs: configuredPushTimeout(),
      redactions: [pushUrl, password],
    },
  );
}

async function describeStructure(connectionString) {
  const client = new pg.Client({
    connectionString,
    application_name: "ledger-parity-inspector",
  });
  await client.connect();
  try {
    const tables = await client.query(`
      SELECT relation.relname AS table_name
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> 'ledger_schema_migrations'
      ORDER BY relation.relname
    `);
    const columns = await client.query(`
      SELECT
        relation.relname AS table_name,
        attribute.attname AS column_name,
        format_type(attribute.atttypid, attribute.atttypmod) AS normalized_type,
        NOT attribute.attnotnull AS nullable
      FROM pg_attribute AS attribute
      JOIN pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> 'ledger_schema_migrations'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY relation.relname, attribute.attnum
    `);
    const foreignKeys = await client.query(`
      SELECT
        source.relname AS table_name,
        ARRAY(
          SELECT source_attribute.attname
          FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute AS source_attribute
            ON source_attribute.attrelid = constraint_row.conrelid
           AND source_attribute.attnum = key.attnum
          ORDER BY key.position
        ) AS columns,
        target.relname AS referenced_table,
        ARRAY(
          SELECT target_attribute.attname
          FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute AS target_attribute
            ON target_attribute.attrelid = constraint_row.confrelid
           AND target_attribute.attnum = key.attnum
          ORDER BY key.position
        ) AS referenced_columns,
        constraint_row.confupdtype AS update_action,
        constraint_row.confdeltype AS delete_action
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS source ON source.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = source.relnamespace
      JOIN pg_class AS target ON target.oid = constraint_row.confrelid
      WHERE constraint_row.contype = 'f'
        AND namespace.nspname = 'public'
      ORDER BY source.relname, columns, target.relname, referenced_columns
    `);
    return {
      tables: tables.rows,
      columns: columns.rows,
      foreignKeys: foreignKeys.rows,
    };
  } finally {
    await client.end();
  }
}

export async function compareDatabaseStructures(migrationUrl, pushUrl) {
  const migrationStructure = await describeStructure(migrationUrl);
  const pushStructure = await describeStructure(pushUrl);
  const expected = JSON.stringify(pushStructure);
  const actual = JSON.stringify(migrationStructure);
  if (actual !== expected) {
    throw new Error(
      "database schema parity mismatch\n" +
        `migration structure: ${JSON.stringify(migrationStructure, null, 2)}\n` +
        `drizzle push structure: ${JSON.stringify(pushStructure, null, 2)}`,
    );
  }
  return migrationStructure;
}

async function dropDisposableDatabase(admin, databaseName) {
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
}

export async function checkMigrationParity({
  databaseAdminUrl = process.env.DATABASE_ADMIN_URL,
  applicationUrl = process.env.DATABASE_URL,
  dotenvDirectory,
  beforeCompare,
} = {}) {
  if (!databaseAdminUrl) {
    throw new Error(
      "DATABASE_ADMIN_URL is required to provision parity databases",
    );
  }
  if (!applicationUrl) {
    throw new Error(
      "DATABASE_URL is required to verify ledger_app integrity during parity",
    );
  }

  const suffix = randomUUID().replaceAll("-", "");
  const migrationDatabase = `ledger_parity_migration_${suffix}`;
  const pushDatabase = `ledger_parity_push_${suffix}`;
  const migrationUrl = databaseUrl(databaseAdminUrl, migrationDatabase);
  const pushUrl = databaseUrl(databaseAdminUrl, pushDatabase);
  const migrationApplicationUrl = databaseUrl(
    applicationUrl,
    migrationDatabase,
  );
  const admin = new pg.Client({
    connectionString: databaseAdminUrl,
    application_name: "ledger-parity-provisioner",
  });
  await admin.connect();
  let primaryError;
  let result;
  try {
    await admin.query(`CREATE DATABASE ${quotedIdentifier(migrationDatabase)}`);
    await admin.query(`CREATE DATABASE ${quotedIdentifier(pushDatabase)}`);
    await applyMigrations({ databaseAdminUrl: migrationUrl });
    await runDrizzlePush(pushUrl, { dotenvDirectory });
    await verifyMigratedSchema({
      databaseAdminUrl: migrationUrl,
      applicationUrl: migrationApplicationUrl,
    });
    if (beforeCompare) {
      await beforeCompare({ migrationUrl, pushUrl });
    }
    result = await compareDatabaseStructures(migrationUrl, pushUrl);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    for (const databaseName of [migrationDatabase, pushDatabase]) {
      try {
        await dropDisposableDatabase(admin, databaseName);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    await admin.end().catch((error) => cleanupErrors.push(error));
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
        primaryError
          ? "migration parity and cleanup both failed"
          : "failed to clean parity databases exactly",
      );
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

async function main() {
  const structure = await checkMigrationParity();
  console.log(
    `✓ committed migrations match drizzle-kit push: ` +
      `${structure.tables.length} table(s), ${structure.columns.length} column(s), ` +
      `${structure.foreignKeys.length} foreign key(s)`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`✗ committed migration parity failed: ${error.message}`);
    process.exitCode = 1;
  });
}
