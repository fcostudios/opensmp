import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { calculatePool } from "./pool-math.js";

describe("US-022 canonical pool arithmetic", () => {
  it("derives free capacity for seeded non-negative inputs", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (purchased, assigned, pendingInvites) => {
          expect(
            calculatePool({ assigned, pendingInvites, purchased }).free,
          ).toBe(purchased - assigned - pendingInvites);
        },
      ),
      { seed: 22 },
    );
  });

  it("increasing purchased by k increases free by exactly k", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (purchased, assigned, pendingInvites, k) => {
          const before = calculatePool({
            assigned,
            pendingInvites,
            purchased,
          });
          const after = calculatePool({
            assigned,
            pendingInvites,
            purchased: purchased + k,
          });
          expect(after.free - before.free).toBe(k);
        },
      ),
      { seed: 2202 },
    );
  });
});
