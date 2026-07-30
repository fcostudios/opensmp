export function normalizeIntlWhitespace(value: string): string {
  return value.replace(/[\u00a0\u202f]/gu, " ");
}
