export const EXACT_HEX_FRAGMENT = "#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})";
const exactHex = new RegExp(`^${EXACT_HEX_FRAGMENT}$`);

export function isExactHex(value) {
  return typeof value === "string" && exactHex.test(value);
}

export function normalizeExactHex(value) {
  if (!isExactHex(value)) return null;
  let hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = hex.split("").map((channel) => channel + channel).join("");
  if (hex.length === 6) hex += "ff";
  return `${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${parseInt(hex.slice(6, 8), 16)}`;
}
