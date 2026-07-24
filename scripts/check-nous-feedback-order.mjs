#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const path = `${root}/.nous-feedback.jsonl`;
const records = readFileSync(path, "utf8").trimEnd().split("\n").map((line, index) => {
  try {
    const record = JSON.parse(line);
    if (!record.story || !record.event) throw new Error("requires story and event");
    return record;
  } catch (error) {
    console.error(`[nous-feedback order] line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
});

const residualStart = records.findIndex((record) => record.notes?.includes("Final residual-fix"));
if (residualStart === -1) {
  console.error("[nous-feedback order] missing final residual-fix evidence");
  process.exit(1);
}
const residualCycle = records.slice(residualStart);
if (residualCycle.length !== 3 || residualCycle.map((record) => record.event).join(",") !== "ac_verify,build_pass,done") {
  console.error("[nous-feedback order] final residual-fix evidence must be the append-only EOF lifecycle cycle");
  process.exit(1);
}

console.log("[nous-feedback order] ok");
