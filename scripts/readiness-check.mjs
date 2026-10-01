#!/usr/bin/env node
// IMP-403 / I02 — validate this package's readiness artifacts against the
// contract the substrate emits beside this script.
//
// WHAT IT ASKS: for every artifact in the readiness directory, is each field the
// artifact DECLARES the shape the substrate will read? Nothing is required — the
// substrate's readers all name an absent key as an excluded reason — so a missing
// field is never a finding and a malformed one always is.
//
// WHAT IT DOES NOT ASK: whether a work item HAS a readiness decision. That needs
// the story set, which only the substrate has; ready-check 169 and the
// [Readiness Decision] drift section already answer it.
//
// SELF-GATING: with no contract file on disk the readiness primitive is not
// activated for this project, and this script exits 0 after saying so. The rules
// live in the contract, never here — one authority, one consumer.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const CONTRACT_REL = "docs/dev-guide/readiness-artifact.schema.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

let contract;
try {
  contract = readJson(join(root, ...CONTRACT_REL.split("/")));
} catch {
  console.log(`[readiness] skipped — no ${CONTRACT_REL} (work readiness is not activated for this project)`);
  process.exit(0);
}

const readyDir = join(root, ...String(contract.readiness_dir || "").split("/"));
let entries;
try {
  entries = readdirSync(readyDir).filter((n) => n.endsWith(".json")).sort();
} catch {
  console.log(`[readiness] skipped — no ${contract.readiness_dir}/ directory`);
  process.exit(0);
}

// `typeof` cannot distinguish an array, and null is an "object". One helper, so
// every field uses the same answer.
function jsonType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isFinite(v) ? "number" : "null";
  return typeof v;            // string | object | boolean | undefined
}

// Dotted path lookup. Returns the sentinel when any segment is missing, so
// "declared as null" is distinguishable from "not declared".
const ABSENT = Symbol("absent");
function dig(obj, path) {
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !(seg in cur)) return ABSENT;
    cur = cur[seg];
  }
  return cur;
}

const problems = [];
let checkedFiles = 0, checkedFields = 0;

for (const name of entries) {
  const rel = `${contract.readiness_dir}/${name}`;
  const stem = name.slice(0, -".json".length);
  let doc;
  try {
    doc = readJson(join(readyDir, name));
  } catch (err) {
    problems.push(`${rel}: unreadable JSON — ${err.message}`);
    continue;
  }
  if (jsonType(doc) !== "object") {
    problems.push(`${rel}: top level is ${jsonType(doc)}, expected object`);
    continue;
  }
  if (contract.work_id_pattern && !new RegExp(contract.work_id_pattern).test(stem)) {
    problems.push(`${rel}: filename stem "${stem}" is not a work id (${contract.work_id_pattern})`);
  }
  checkedFiles++;

  for (const field of contract.fields || []) {
    const value = dig(doc, field.path);
    if (value === ABSENT) continue;            // nothing is required
    checkedFields++;
    const actual = jsonType(value);
    if (!field.types.includes(actual)) {
      problems.push(`${rel}: ${field.path} is ${actual}, expected ${field.types.join("|")}`);
      continue;                                 // a wrong type makes the rest moot
    }
    if (field.non_empty && String(value).trim() === "") {
      problems.push(`${rel}: ${field.path} is empty`);
    }
    if (field.enum && !field.enum.includes(value)) {
      problems.push(`${rel}: ${field.path} is "${value}", not one of ${field.enum.join("|")}`);
    }
    if (field.pattern && actual === "string" && !new RegExp(field.pattern).test(value)) {
      problems.push(`${rel}: ${field.path} "${value}" does not match ${field.pattern}`);
    }
    if (field.must_equal_filename_stem && value !== stem) {
      problems.push(`${rel}: ${field.path} is "${value}" but the filename says "${stem}"`);
    }
    // IMP-411 — a block whose declared members must add up to another field.
    // Only the NAMED members count (a tenant may carry extra keys); a member
    // that is not a number is its own type finding above, never summed; an
    // absent or non-numeric target yields nothing (typed-if-present).
    if (field.sum_members && actual === "object") {
      const target = dig(doc, field.sum_equals);
      if (jsonType(target) === "number") {
        let sum = 0;
        for (const m of field.sum_members) {
          if (jsonType(value[m]) === "number") sum += value[m];
        }
        const delta = Math.abs(sum - target);
        if (delta > (field.sum_tolerance ?? 0)) {
          problems.push(`${rel}: ${field.path} sums to ${sum} but ${field.sum_equals} is ${target} — off by ${delta}`);
        }
      }
    }
    if (field.items && actual === "array") {
      value.forEach((item, i) => {
        const it = jsonType(item);
        if (!field.items.types.includes(it)) {
          problems.push(`${rel}: ${field.path}[${i}] is ${it}, expected ${field.items.types.join("|")}`);
        } else if (field.items.pattern && it === "string" && !new RegExp(field.items.pattern).test(item)) {
          problems.push(`${rel}: ${field.path}[${i}] "${item}" does not match ${field.items.pattern}`);
        }
      });
    }
  }
}

for (const p of problems) console.error(`[readiness] ${p}`);
console.error(`[readiness] diagnostic: ${checkedFiles} artifact(s), ${checkedFields} declared field(s) checked`);
if (problems.length) {
  console.error(`[readiness] ${problems.length} problem(s) — see docs/dev-guide/READINESS.md and ${CONTRACT_REL}`);
  process.exit(1);
}
console.log("[readiness] ok");
// nous-emitted: sha256=6d58149b20eff6fd
