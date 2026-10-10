export type InactivityWindow = 30 | 60 | 90;
export type InactivityInput = Readonly<{
  evaluationDate: string;
  accountDataThrough: string | null;
  lastActivityDate: string | null;
  window: InactivityWindow;
}>;
export type InactivityResult = Readonly<{
  dataThrough: string;
  lastActivityDate: string | null;
  daysInactive: number | null;
  classification: "active" | "inactive" | "no_data";
}>;

const DAY_MS = 86400000;
function utcDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid UTC date");
  const milliseconds = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid UTC date");
  }
  return milliseconds / DAY_MS;
}

/** Count against confirmed account observations, never the provider's sync lag. */
export function evaluateInactivity(input: InactivityInput): InactivityResult {
  if (![30, 60, 90].includes(input.window)) throw new Error("Invalid inactivity window");
  const evaluationDay = utcDay(input.evaluationDate);
  const throughDay = input.accountDataThrough === null ? evaluationDay - 3 : utcDay(input.accountDataThrough);
  const dataThrough = new Date(throughDay * DAY_MS).toISOString().slice(0, 10);
  if (input.lastActivityDate === null) {
    return { dataThrough, lastActivityDate: null, daysInactive: null, classification: "no_data" };
  }
  const daysInactive = throughDay - utcDay(input.lastActivityDate);
  if (daysInactive < 0) throw new Error("Activity is later than account data-through");
  return {
    dataThrough,
    lastActivityDate: input.lastActivityDate,
    daysInactive,
    classification: daysInactive > input.window ? "inactive" : "active",
  };
}

function ownMetric(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, key)) return undefined;
  return (value as Record<string, unknown>)[key];
}
function positiveCount(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
function anyPositive(value: unknown, fields: readonly string[]): boolean {
  return fields.some(field => positiveCount(ownMetric(value, field)));
}

/** Explicit normalized activity allowlist; metadata and session counts are not use. */
export function hasPositiveVendorActivity(counters: unknown): boolean {
  if (positiveCount(ownMetric(ownMetric(counters, "chat_metrics"), "message_count"))) return true;
  const code = ownMetric(counters, "claude_code_metrics");
  const core = ownMetric(code, "core_metrics");
  if (anyPositive(core, ["commit_count", "pull_request_count"]) || anyPositive(ownMetric(core, "lines_of_code"), ["added_count", "removed_count"])) return true;
  const actions = ownMetric(code, "tool_actions");
  if (["edit_tool", "multi_edit_tool", "notebook_edit_tool", "write_tool"].some(tool => anyPositive(ownMetric(actions, tool), ["accepted_count", "rejected_count"]))) return true;
  return anyPositive(ownMetric(counters, "cowork_metrics"), [
    "message_count", "action_count", "file_edit_count", "sessions_with_file_edits_count",
    "edit_tool_count", "multi_edit_tool_count", "notebook_edit_tool_count", "write_tool_count",
  ]);
}
