#!/usr/bin/env node
// CHG-066 — refuse to start the full gate while stale test containers exist.
//
// A failed or killed run used to leave its containers behind (Ryuk was
// disabled for apps/web, and the US-004 Keycloak test used a raw `docker run`);
// twenty of them were running during CHG-064's measurement rounds and every
// later gate paid for them. Stale means one of:
//   - a testcontainers container whose session has no running Ryuk to reap it
//     (Ryuk is shared per user, so a concurrent run's containers belong to a
//     live session and are not stale);
//   - a legacy `ledger-us004-<uuid>` Keycloak container from the raw
//     `docker run`, which carries no testcontainers label.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FIELDS = [
  "{{.ID}}",
  "{{.Names}}",
  "{{.State}}",
  '{{.Label "org.testcontainers"}}',
  '{{.Label "org.testcontainers.session-id"}}',
  '{{.Label "org.testcontainers.ryuk"}}',
];
export const DOCKER_PS_ARGS = ["ps", "--all", "--no-trunc", "--format", FIELDS.join("\t")];

const LEGACY_KEYCLOAK = /^ledger-us004-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function parseDockerPs(output) {
  return output.split("\n").filter((line) => line.trim() !== "").map((line) => {
    const [id, name, state, testcontainers, sessionId, ryuk] = line.split("\t");
    return { id, name, state, testcontainers: testcontainers === "true", sessionId: sessionId ?? "", ryuk: ryuk === "true" };
  });
}

function isRyuk(container) {
  return container.ryuk || container.name.startsWith("testcontainers-ryuk-");
}

export function staleTestContainers(containers) {
  const liveSessions = new Set(containers
    .filter((container) => isRyuk(container) && container.state === "running" && container.sessionId !== "")
    .map((container) => container.sessionId));
  return containers.filter((container) => {
    if (isRyuk(container)) return false;
    if (container.testcontainers) return !liveSessions.has(container.sessionId);
    return LEGACY_KEYCLOAK.test(container.name);
  });
}

export function staleReport(stale) {
  if (stale.length === 0) return null;
  const lines = stale.map((container) => `  ${container.id.slice(0, 12)}  ${container.name}  (${container.state})`);
  return [
    `pnpm check refused: ${stale.length} stale test container(s) from earlier runs would load Docker during the gate:`,
    ...lines,
    "Remove them, then rerun:",
    `docker rm -f ${stale.map((container) => container.id.slice(0, 12)).join(" ")}`,
  ].join("\n");
}

function main() {
  let output;
  try {
    output = execFileSync("docker", DOCKER_PS_ARGS, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    console.error(`pnpm check refused: cannot list Docker containers (the gate's integration tests need Docker): ${error.message}`);
    process.exit(1);
  }
  const report = staleReport(staleTestContainers(parseDockerPs(output)));
  if (report) {
    console.error(report);
    process.exit(1);
  }
  console.log("[stale test containers] none");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
