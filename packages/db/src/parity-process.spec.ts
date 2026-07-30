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
  test("resolves and executes pnpm through the active Node package-manager CLI", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    const invocation = imported.resolvePnpmInvocation(["--version"]);
    if (process.env.npm_execpath?.toLowerCase().includes("pnpm")) {
      if (/\.(?:c|m)?js$/iu.test(process.env.npm_execpath)) {
        expect(invocation.command).toBe(process.execPath);
        expect(invocation.args[0]).toBe(process.env.npm_execpath);
      } else if (process.platform === "win32") {
        expect(invocation.command).toBe(process.env.ComSpec ?? "cmd.exe");
        expect(invocation.args).toEqual([
          "/d",
          "/s",
          "/c",
          process.env.npm_execpath,
          "--version",
        ]);
      }
    } else {
      expect(invocation.command).toBe(
        process.platform === "win32"
          ? process.env.ComSpec ?? "cmd.exe"
          : "pnpm",
      );
    }

    const result = await imported.runBoundedProcess(
      invocation.command,
      invocation.args,
      {
        timeoutMs: 5_000,
        maxOutputBytes: 1_024,
      },
    );
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("uses the platform command shim when no pnpm CLI path is available", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    expect(
      imported.resolvePnpmInvocation(["--version"], {
        env: {
          ComSpec: "C:\\Windows\\System32\\cmd.exe",
          npm_execpath: "C:\\tools\\pnpm.CMD",
        },
        platform: "win32",
        execPath: "C:\\node\\node.exe",
      }),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "C:\\tools\\pnpm.CMD", "--version"],
    });
    expect(
      imported.resolvePnpmInvocation(["--version"], {
        env: { npm_execpath: "C:\\tools\\pnpm.cjs" },
        platform: "win32",
        execPath: "C:\\node\\node.exe",
      }),
    ).toEqual({
      command: "C:\\node\\node.exe",
      args: ["C:\\tools\\pnpm.cjs", "--version"],
    });
    expect(
      imported.resolvePnpmInvocation(["--version"], {
        env: {},
        platform: "win32",
      }),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "pnpm.cmd", "--version"],
    });
    expect(
      imported.resolvePnpmInvocation(["--version"], {
        env: {},
        platform: "linux",
      }),
    ).toEqual({
      command: "pnpm",
      args: ["--version"],
    });
  });

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

  test("does not leak a secret split across the output cap boundary", async () => {
    const imported = await import(pathToFileURL(parityPath).href);
    const maxOutputBytes = 128;
    const secret = "boundary-secret-must-never-leak";
    const prefix = secret.slice(0, 8);
    const suffix = secret.slice(-8);
    const source = `
      process.stderr.write("x".repeat(120) + ${JSON.stringify(secret)} + "tail");
      process.exit(2);
    `;
    let failure: unknown;
    try {
      await imported.runBoundedProcess(process.execPath, ["-e", source], {
        timeoutMs: 2_000,
        maxOutputBytes,
        redactions: [secret],
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).not.toContain(secret);
    expect(message).not.toContain(prefix);
    expect(message).not.toContain(suffix);
    expect(message).toContain("[output truncated]");
    expect(Buffer.byteLength(message)).toBeLessThan(maxOutputBytes + 128);
  });
});
