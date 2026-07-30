export interface PoolCounts {
  readonly assigned: number;
  readonly pendingInvites: number;
  readonly purchased: number;
}

export interface PoolSnapshot extends PoolCounts {
  readonly free: number;
}

export function calculatePool(counts: PoolCounts): PoolSnapshot {
  return {
    ...counts,
    free: counts.purchased - counts.assigned - counts.pendingInvites,
  };
}
