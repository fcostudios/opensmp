import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const parityPath = resolve(
  import.meta.dirname,
  "../scripts/check-migration-parity.mjs",
);

describe("bounded parity child process", () => {
  test("times out and terminates the entire local subprocess tree", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    const directory = await mkdtemp(join(tmpdir(), "ledger-process-"));
    const marker = join(directory, "grandchild-survived");
    const source = `
      const { spawn } = require("node:child_process");
      spawn(process.execPath, [
        "-e",
        ${JSON.stringify(
          `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived"), 700)`,
        )}
      ], { stdio: "ignore" });
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `;
    try {
      await expect(
        imported.runBoundedProcess(process.execPath, ["-e", source], {
          timeoutMs: 100,
          killGraceMs: 100,
          maxOutputBytes: 2_048,
        }),
      ).rejects.toThrow("timed out");
      await new Promise((resolveWait) => setTimeout(resolveWait, 900));
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 5_000);

  test("bounds and redacts failed child output", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    const secret = "do-not-print-this-password";
    const connectionUrl = `postgresql://ledger_owner:${secret}@127.0.0.1:5432/ledger`;
    const source = `
      process.stderr.write(${JSON.stringify(connectionUrl)});
      process.stderr.write("x".repeat(10000));
      process.exit(2);
    `;
    let failure: unknown;
    try {
      await imported.runBoundedProcess(process.execPath, ["-e", source], {
        timeoutMs: 2_000,
        killGraceMs: 100,
        maxOutputBytes: 1_024,
        redactions: [connectionUrl, secret],
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).not.toContain(secret);
    expect(message).not.toContain(connectionUrl);
    expect(message).toContain("[REDACTED]");
    expect(message).toContain("[output truncated]");
    expect(Buffer.byteLength(message)).toBeLessThan(2_048);
  });
});
