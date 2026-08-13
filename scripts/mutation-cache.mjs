#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import { clearMutationCache, inspectMutationCache } from "./mutation-evidence/cache.mjs";

function runGit(args) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" }).trim();
}

const [command, ...extraArguments] = process.argv.slice(2);
if (extraArguments.length !== 0 || !["inspect", "clear"].includes(command)) {
  process.stderr.write("Usage: mutation-cache.mjs <inspect|clear>\n");
  process.exitCode = 2;
} else {
  const action = command === "clear" ? clearMutationCache : inspectMutationCache;
  const { root, count } = action({ repoRoot: process.cwd(), runGit });
  if (command === "clear") {
    process.stdout.write(`Cleared ${count} mutation cache entries from ${root}\n`);
  } else {
    process.stdout.write(`Mutation cache: ${root}\nEntries: ${count}\n`);
  }
}
