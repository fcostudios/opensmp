/** USD decimals cross this boundary as strings; percentages never use rounded floats. */
export function cents(value: string): bigint {
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(value)) throw new Error("INVALID_MONEY");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const amount = BigInt(whole!) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return value.startsWith("-") ? -amount : amount;
}
export function dollars(value: bigint): string {
  // @equivalent: changing < to <= only negates 0n, which is exactly 0n.
  const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}
export function compareInvoice(rollup: string, invoice: string) {
  const billed = cents(invoice);
  if (billed < BigInt(0)) throw new Error("INVALID_INVOICE");
  const delta = cents(rollup) - billed;
  // @equivalent: the absolute-delta < to <= boundary only negates 0n; -0n equals 0n.
  return { varianceUsd: dollars(delta), withinTolerance: (delta < BigInt(0) ? -delta : delta) * BigInt(200) <= billed };
}
