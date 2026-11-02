/** Escape a CSV field; numeric=true is reserved for trusted DB numeric columns. */
export function csvCell(value: string | number | null, numeric = false): string {
  const raw = value === null ? "" : String(value);
  const safe = !numeric && /^[\s\0-\x1f]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

