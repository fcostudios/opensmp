import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { subtractUsd } from "./money";

describe("approval money arithmetic", () => {
  test("subtracts in integer cents for every representable approval amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        (leftCents, rightCents) => {
          expect(
            Math.round(
              subtractUsd(leftCents / 100, rightCents / 100) * 100,
            ),
          ).toBe(leftCents - rightCents);
        },
      ),
    );
  });

  test("is reversible at cent precision", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        (leftCents, rightCents) => {
          const difference = subtractUsd(
            leftCents / 100,
            rightCents / 100,
          );
          expect(subtractUsd(difference, -rightCents / 100)).toBe(
            leftCents / 100,
          );
        },
      ),
    );
  });
});
