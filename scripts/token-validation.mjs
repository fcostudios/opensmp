export const EXACT_HEX_FRAGMENT = "#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})";
const exactHex = new RegExp(`^${EXACT_HEX_FRAGMENT}$`);

export function isExactHex(value) {
  return typeof value === "string" && exactHex.test(value);
}
