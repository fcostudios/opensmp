export type SeatPoolCapacity = {
  effectiveFrom: string;
  id: string;
  licenseTypeId: string;
  purchasedQty: number;
  vendorAccountId: string;
};

export type SeatPoolAssignment = {
  endedOn: string | null;
  licenseTypeId: string;
  startedOn: string;
  vendorAccountId: string;
};

export type SeatPoolPendingInvite = {
  licenseTypeId: string;
  vendorAccountId: string;
};

export type SeatPool = {
  assigned: number;
  free: number;
  licenseTypeId: string;
  pending: number;
  purchased: number;
  vendorAccountId: string;
};

export function calculateSeatPools(input: {
  asOf: string;
  assignments: readonly SeatPoolAssignment[];
  capacities: readonly SeatPoolCapacity[];
  pendingInvites: readonly SeatPoolPendingInvite[];
}): SeatPool[] {
  requireIsoDate(input.asOf, "asOf");
  const latest = new Map<string, SeatPoolCapacity>();
  for (const capacity of input.capacities) {
    requireIsoDate(capacity.effectiveFrom, "capacity.effectiveFrom");
    if (capacity.effectiveFrom > input.asOf) continue;
    const key = poolKey(capacity);
    const current = latest.get(key);
    if (
      !current ||
      capacity.effectiveFrom > current.effectiveFrom ||
      // Stryker disable next-line EqualityOperator:
      // @equivalent capacity ids are unique, so > and >= are indistinguishable.
      (capacity.effectiveFrom === current.effectiveFrom && capacity.id > current.id)
    ) {
      latest.set(key, capacity);
    }
  }

  return [...latest.values()]
    .map((capacity) => {
      const matches = (item: { licenseTypeId: string; vendorAccountId: string }) =>
        item.vendorAccountId === capacity.vendorAccountId &&
        item.licenseTypeId === capacity.licenseTypeId;
      const assigned = input.assignments.filter(
        (assignment) =>
          matches(assignment) &&
          assignment.startedOn <= input.asOf &&
          (assignment.endedOn === null || assignment.endedOn >= input.asOf),
      ).length;
      const pending = input.pendingInvites.filter(matches).length;
      return {
        assigned,
        free: capacity.purchasedQty - assigned - pending,
        licenseTypeId: capacity.licenseTypeId,
        pending,
        purchased: capacity.purchasedQty,
        vendorAccountId: capacity.vendorAccountId,
      };
    })
    .sort(
      (left, right) =>
        left.vendorAccountId.localeCompare(right.vendorAccountId) ||
        left.licenseTypeId.localeCompare(right.licenseTypeId),
    );
}

function poolKey(input: { licenseTypeId: string; vendorAccountId: string }): string {
  return `${input.vendorAccountId}\u0000${input.licenseTypeId}`;
}

function requireIsoDate(value: string, name: string): void {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) {
    throw new TypeError(`${name} must be an ISO date`);
  }
}
