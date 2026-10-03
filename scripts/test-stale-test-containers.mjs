#!/usr/bin/env node
import assert from "node:assert/strict";

import { parseDockerPs, staleReport, staleTestContainers } from "./check-stale-test-containers.mjs";

const SESSION_LIVE = "11111111111111111111111111111111";
const SESSION_DEAD = "22222222222222222222222222222222";
const KEYCLOAK = "ledger-us004-97b6461f-4d01-45eb-8834-19ba2543a465";

function row(id, name, state, testcontainers, sessionId, ryuk) {
  return [id.padEnd(64, "0"), name, state, testcontainers, sessionId, ryuk].join("\t");
}

const tests = [];
function test(name, body) { tests.push([name, body]); }

test("parses the tab-separated docker ps format, including empty labels", () => {
  const parsed = parseDockerPs(`${row("aa", "pg-a", "running", "true", SESSION_DEAD, "")}\n${row("bb", "nous-db", "running", "", "", "")}\n`);
  assert.deepEqual(parsed.map(({ name, testcontainers, sessionId, ryuk }) => ({ name, testcontainers, sessionId, ryuk })), [
    { name: "pg-a", testcontainers: true, sessionId: SESSION_DEAD, ryuk: false },
    { name: "nous-db", testcontainers: false, sessionId: "", ryuk: false },
  ]);
});

test("a container of a session with a running Ryuk is live, of a session without one is stale", () => {
  const containers = parseDockerPs([
    row("01", `testcontainers-ryuk-${SESSION_LIVE}`, "running", "true", SESSION_LIVE, "true"),
    row("02", "live-pg", "running", "true", SESSION_LIVE, ""),
    row("03", "live-created", "created", "true", SESSION_LIVE, ""),
    row("04", "dead-pg", "running", "true", SESSION_DEAD, ""),
    row("05", "dead-created", "created", "true", SESSION_DEAD, ""),
    row("06", "dead-exited", "exited", "true", SESSION_DEAD, ""),
  ].join("\n"));
  assert.deepEqual(staleTestContainers(containers).map((container) => container.name), ["dead-pg", "dead-created", "dead-exited"]);
});

test("an exited Ryuk does not keep its session live", () => {
  const containers = parseDockerPs([
    row("01", `testcontainers-ryuk-${SESSION_DEAD}`, "exited", "true", SESSION_DEAD, "true"),
    row("02", "orphan", "running", "true", SESSION_DEAD, ""),
  ].join("\n"));
  assert.deepEqual(staleTestContainers(containers).map((container) => container.name), ["orphan"]);
});

test("Ryuk-disabled containers (random session, no reaper) are stale", () => {
  const containers = parseDockerPs(row("01", "ryuk-disabled-pg", "running", "true", SESSION_DEAD, ""));
  assert.equal(staleTestContainers(containers).length, 1);
});

test("a legacy unlabelled US-004 Keycloak is stale; unrelated containers never are", () => {
  const containers = parseDockerPs([
    row("01", KEYCLOAK, "running", "", "", ""),
    row("02", "ledger-us004-compose-contract-app-1", "running", "", "", ""),
    row("03", "nous-keycloak", "running", "", "", ""),
    row("04", "ledger-dev-worker-1", "restarting", "", "", ""),
  ].join("\n"));
  assert.deepEqual(staleTestContainers(containers).map((container) => container.name), [KEYCLOAK]);
});

test("the refusal prints the exact docker rm line for every stale container", () => {
  const stale = staleTestContainers(parseDockerPs([
    row("abcdef123456", "dead-pg", "running", "true", SESSION_DEAD, ""),
    row("fedcba654321", KEYCLOAK, "running", "", "", ""),
  ].join("\n")));
  const report = staleReport(stale);
  assert.equal(report.split("\n").at(-1), "docker rm -f abcdef123456 fedcba654321");
  assert.match(report, /^pnpm check refused: 2 stale test container\(s\)/u);
  assert.equal(staleReport([]), null);
});

for (const [name, body] of tests) {
  try {
    body();
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
console.log(`stale test containers: ${tests.length} behavioral tests passed`);
