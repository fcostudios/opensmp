/** BR-17: ISO dates are inclusive; all money arithmetic is integer cents. */
export interface CloseAssignment {
  id: string; companyId: string; personId: string; vendorAccountId: string;
  licenseTypeId: string; startedOn: string; endedOn: string | null;
}
export interface CloseRate {
  id: string; vendorAccountId: string; licenseTypeId: string; monthlyRateUsd: string;
  effectiveFrom: string; effectiveTo: string | null; provisional: boolean;
}
export interface LicenseCloseLine {
  companyId: string; assignmentId: string; personId: string; vendorAccountId: string;
  licenseTypeId: string; licenseDays: number; rateUsd: string; amountUsd: string;
  periodFrom: string; periodTo: string; note: string | null;
}
const dayMs = 86_400_000;
const epoch = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
export function monthBounds(period: string) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("CLOSE_INVALID_PERIOD");
  const from = `${period}-01`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const days = (next.valueOf() - epoch(from)) / dayMs;
  return { from, to: iso(next.valueOf() - dayMs), days };
}
function usd(cents: bigint): string {
  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
function cents(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole!) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function computeLicenseClose(period: string, assignments: readonly CloseAssignment[], rates: readonly CloseRate[]): LicenseCloseLine[] {
  const month = monthBounds(period);
  const pieces: { line: Omit<LicenseCloseLine, "amountUsd">; rateId: string }[] = [];
  for (const assignment of assignments) {
    const start = Math.max(epoch(assignment.startedOn), epoch(month.from));
    const end = Math.min(epoch(assignment.endedOn ?? month.to), epoch(month.to));
    if (start > end) continue;
    const matching = rates.filter(rate => rate.vendorAccountId === assignment.vendorAccountId && rate.licenseTypeId === assignment.licenseTypeId)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    let cursor = start;
    for (const rate of matching) {
      const from = Math.max(start, epoch(rate.effectiveFrom));
      const to = Math.min(end, epoch(rate.effectiveTo ?? month.to));
      if (from > to) continue;
      if (from !== cursor) throw new Error("CLOSE_RATE_COVERAGE");
      const licenseDays = (to - from) / dayMs + 1;
      pieces.push({ rateId: rate.id, line: {
        companyId: assignment.companyId, assignmentId: assignment.id, personId: assignment.personId,
        vendorAccountId: assignment.vendorAccountId, licenseTypeId: assignment.licenseTypeId,
        licenseDays, rateUsd: rate.monthlyRateUsd, periodFrom: iso(from), periodTo: iso(to),
        note: rate.provisional ? "provisional_rate" : null,
      } });
      cursor = to + dayMs;
    }
    if (cursor !== end + dayMs) throw new Error("CLOSE_RATE_COVERAGE");
  }
  // Cumulative rounding per person/catalog/rate conserves cents across transfers.
  // The final chronological segment receives any residual cent, deterministically.
  pieces.sort((a, b) => JSON.stringify([a.line.personId, a.line.vendorAccountId, a.line.licenseTypeId, a.line.periodFrom, a.rateId, a.line.assignmentId])
    .localeCompare(JSON.stringify([b.line.personId, b.line.vendorAccountId, b.line.licenseTypeId, b.line.periodFrom, b.rateId, b.line.assignmentId])));
  const cumulative = new Map<string, number>();
  const round = (numerator: bigint) => (numerator * BigInt(2) + BigInt(month.days)) / (BigInt(2) * BigInt(month.days));
  return pieces.map(({ line, rateId }) => {
    const key = JSON.stringify([line.personId, line.vendorAccountId, line.licenseTypeId, rateId]);
    const previous = cumulative.get(key) ?? 0;
    const days = previous + line.licenseDays;
    cumulative.set(key, days);
    return { ...line, amountUsd: usd(round(cents(line.rateUsd) * BigInt(days)) - round(cents(line.rateUsd) * BigInt(previous))) };
  });
}
