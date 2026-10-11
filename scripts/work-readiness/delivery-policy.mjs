// CHG-082: closed path list shared by readiness estimates and ownership classes.
export const BOOKKEEPING_PREFIXES = Object.freeze([
  "docs/readiness/", "docs/superpowers/specs/", "docs/superpowers/plans/",
]);
export function isBookkeepingPath(path) {
  return path === ".nous-feedback.jsonl" || BOOKKEEPING_PREFIXES.some((prefix) => path.startsWith(prefix));
}
export function deliveryFileSignals(paths) {
  const unique = [...new Set(paths)];
  const bookkeeping_files = unique.filter(isBookkeepingPath).length;
  return { expected_changed_files: unique.length - bookkeeping_files, bookkeeping_files };
}
export const MUTATION_ROUTES_PATH = "scripts/mutation-routes.json";
export function isToolingPath(path) {
  return /^(?:scripts\/|infra\/scripts\/|\.githooks\/|testing\/)/u.test(path)
    || /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|(?:stryker|tsconfig|eslint|vitest)[^/]*|[^/]+\.config\.[^/]+)$/u.test(path);
}
export function canonicalRoutePath(path) {
  return typeof path === "string" && path.length > 0 && !path.includes("\0")
    && !path.includes("\\") && !path.startsWith("/")
    && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}
export function validRouteTable(table) {
  return table !== null && typeof table === "object" && !Array.isArray(table)
    && Object.entries(table).every(([source, tests]) => canonicalRoutePath(source)
      && /\.(?:ts|tsx)$/u.test(source) && !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(source)
      && Array.isArray(tests) && tests.length > 0 && new Set(tests).size === tests.length
      && tests.every((path) => canonicalRoutePath(path) && /\.(?:test|spec)\.(?:ts|tsx)$/u.test(path)));
}
