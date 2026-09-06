import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const VITEST_CONFIG_FILES = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.js",
  "vitest.config.mjs",
];

function workspacePatterns(workspaceFile) {
  const invalid = () => {
    throw new Error("pnpm-workspace.yaml: use a non-empty packages block list with literal directory segments or single-star segments (for example packages/*)");
  };
  const patterns = [];
  let inPackages = false;
  for (const line of readFileSync(workspaceFile, "utf8").split(/\r?\n/u)) {
    if (/^packages:/u.test(line) && !/^packages:\s*(?:#.*)?$/u.test(line)) invalid();
    if (/^packages:\s*(?:#.*)?$/u.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^[^\s#]/u.test(line)) break;
    if (/^\s*(?:#.*)?$/u.test(line)) continue;
    const match = /^\s+-\s+(["']?)([^"'#]+)\1\s*(?:#.*)?$/u.exec(line);
    const pattern = match?.[2]?.trim();
    if (!pattern || pattern.split("/").some((part) =>
      part !== "*" && (!/^[\w.-]+$/u.test(part) || part === "." || part === ".."))) invalid();
    patterns.push(pattern);
  }
  if (patterns.length === 0) invalid();
  return patterns;
}

function expandDirectoryPattern(rootDir, pattern) {
  let directories = [resolve(rootDir)];
  for (const part of pattern.split("/").filter(Boolean)) {
    if (part === "*") {
      directories = directories.flatMap((directory) =>
        readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => resolve(directory, entry.name)),
      );
    } else {
      directories = directories.map((directory) => resolve(directory, part));
    }
    directories = directories.filter((directory) =>
      existsSync(directory) && statSync(directory).isDirectory(),
    );
  }
  return directories;
}

function invokesVitest(script) {
  const tokens = [];
  let token = "";
  let quote = null;
  for (const character of script) {
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/[\s;&|()]/u.test(character)) {
      tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (quote) throw new Error("Vitest workspace audit: unclosed shell quote in package script");
  tokens.push(token);
  return tokens.some((value) => value === "vitest" || value.endsWith("/vitest"));
}

function packageUsesVitest(manifest) {
  return Object.values(manifest.scripts ?? {}).some((script) =>
    typeof script === "string" && invokesVitest(script),
  );
}

export function findVitestWorkspaceConfigFailures(rootDir) {
  const absoluteRoot = resolve(rootDir);
  const packageDirectories = workspacePatterns(
    resolve(absoluteRoot, "pnpm-workspace.yaml"),
  )
    .flatMap((pattern) => expandDirectoryPattern(absoluteRoot, pattern))
    .sort((left, right) => left.localeCompare(right));
  const diagnostics = [];

  for (const packageDirectory of packageDirectories) {
    const manifestPath = resolve(packageDirectory, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!packageUsesVitest(manifest)) continue;
    const configCount = VITEST_CONFIG_FILES.filter((file) => {
      const configPath = resolve(packageDirectory, file);
      return existsSync(configPath) && lstatSync(configPath).isFile();
    }).length;
    if (configCount !== 1) {
      const packagePath = relative(absoluteRoot, packageDirectory)
        .split(sep)
        .join("/");
      diagnostics.push(
        configCount === 0
          ? `${packagePath}: test script invokes vitest but no vitest.config.* exists`
          : `${packagePath}: test script invokes vitest but ${configCount} vitest.config.* files exist`,
      );
    }
  }

  return diagnostics.sort((left, right) => left.localeCompare(right));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  const failures = findVitestWorkspaceConfigFailures(process.argv[2] ?? ".");
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Vitest workspace configuration check passed\n");
  }
}
