import { resolve } from "node:path";

import { scanRepositoryBoundary } from "./source-boundary.js";

const repositoryRoot = resolve(process.argv[2] ?? process.cwd());
const violations = await scanRepositoryBoundary(repositoryRoot);

if (violations.length > 0) {
  throw new Error(
    `Provider boundary violations:\n${violations.map((violation) =>
      `${violation.file} -> ${violation.specifier ?? violation.reason}`
    ).join("\n")}`,
  );
}
