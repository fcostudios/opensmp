import { describe, expect, it } from "vitest";

import { calculateSeatPools } from "./pool.js";

describe("US-022 canonical seat-pool calculation", () => {
  it("uses the latest effective capacity independently per account and license type", () => {
    expect(
      calculateSeatPools({
        asOf: "2026-07-27",
        assignments: [
          {
            endedOn: null,
            licenseTypeId: "type-a",
            startedOn: "2026-07-01",
            vendorAccountId: "account-1",
          },
          {
            endedOn: null,
            licenseTypeId: "type-b",
            startedOn: "2026-07-01",
            vendorAccountId: "account-1",
          },
        ],
        capacities: [
          {
            effectiveFrom: "2026-07-01",
            id: "capacity-a-new",
            licenseTypeId: "type-a",
            purchasedQty: 6,
            vendorAccountId: "account-1",
          },
          {
            effectiveFrom: "2026-06-01",
            id: "capacity-a-old",
            licenseTypeId: "type-a",
            purchasedQty: 4,
            vendorAccountId: "account-1",
          },
          {
            effectiveFrom: "2026-07-01",
            id: "capacity-b",
            licenseTypeId: "type-b",
            purchasedQty: 2,
            vendorAccountId: "account-1",
          },
        ],
        pendingInvites: [
          { licenseTypeId: "type-a", vendorAccountId: "account-1" },
          { licenseTypeId: "type-a", vendorAccountId: "account-1" },
        ],
      }),
    ).toEqual([
      {
        assigned: 1,
        free: 3,
        licenseTypeId: "type-a",
        pending: 2,
        purchased: 6,
        vendorAccountId: "account-1",
      },
      {
        assigned: 1,
        free: 1,
        licenseTypeId: "type-b",
        pending: 0,
        purchased: 2,
        vendorAccountId: "account-1",
      },
    ]);
  });

  it("ignores future capacity and closed or not-yet-open assignments", () => {
    expect(
      calculateSeatPools({
        asOf: "2026-07-27",
        assignments: [
          {
            endedOn: "2026-07-26",
            licenseTypeId: "type-a",
            startedOn: "2026-07-01",
            vendorAccountId: "account-1",
          },
          {
            endedOn: null,
            licenseTypeId: "type-a",
            startedOn: "2026-07-28",
            vendorAccountId: "account-1",
          },
        ],
        capacities: [
          {
            effectiveFrom: "2026-07-01",
            id: "current",
            licenseTypeId: "type-a",
            purchasedQty: 5,
            vendorAccountId: "account-1",
          },
          {
            effectiveFrom: "2026-07-28",
            id: "future",
            licenseTypeId: "type-a",
            purchasedQty: 9,
            vendorAccountId: "account-1",
          },
        ],
        pendingInvites: [],
      }),
    ).toEqual([
      {
        assigned: 0,
        free: 5,
        licenseTypeId: "type-a",
        pending: 0,
        purchased: 5,
        vendorAccountId: "account-1",
      },
    ]);
  });

  it("breaks same-day capacity ties by stable row id", () => {
    const input = {
        asOf: "2026-07-27",
        assignments: [],
        capacities: [
          {
            effectiveFrom: "2026-07-01",
            id: "b",
            licenseTypeId: "type-a",
            purchasedQty: 7,
            vendorAccountId: "account-1",
          },
          {
            effectiveFrom: "2026-07-01",
            id: "a",
            licenseTypeId: "type-a",
            purchasedQty: 3,
            vendorAccountId: "account-1",
          },
        ],
        pendingInvites: [],
      } as const;
    expect(calculateSeatPools(input)).toEqual([
      expect.objectContaining({ free: 7, purchased: 7 }),
    ]);
    expect(
      calculateSeatPools({
        ...input,
        capacities: [...input.capacities].reverse(),
      }),
    ).toEqual([
      expect.objectContaining({ free: 7, purchased: 7 }),
    ]);
  });

  it("selects a newer effective row regardless of input order", () => {
    const capacities = [
      {
        effectiveFrom: "2026-06-01",
        id: "old",
        licenseTypeId: "type-a",
        purchasedQty: 2,
        vendorAccountId: "account-1",
      },
      {
        effectiveFrom: "2026-07-01",
        id: "new",
        licenseTypeId: "type-a",
        purchasedQty: 9,
        vendorAccountId: "account-1",
      },
    ];
    for (const ordered of [capacities, [...capacities].reverse()]) {
      expect(
        calculateSeatPools({
          asOf: "2026-07-27",
          assignments: [],
          capacities: ordered,
          pendingInvites: [],
        }),
      ).toEqual([expect.objectContaining({ purchased: 9 })]);
    }
  });

  it("includes same-day capacity and assignment boundaries and isolates accounts", () => {
    expect(
      calculateSeatPools({
        asOf: "2026-07-27",
        assignments: [
          {
            endedOn: "2026-07-27",
            licenseTypeId: "type-a",
            startedOn: "2026-07-27",
            vendorAccountId: "account-1",
          },
          {
            endedOn: null,
            licenseTypeId: "type-a",
            startedOn: "2026-07-01",
            vendorAccountId: "account-2",
          },
        ],
        capacities: [
          {
            effectiveFrom: "2026-07-01",
            id: "account-2",
            licenseTypeId: "type-a",
            purchasedQty: 8,
            vendorAccountId: "account-2",
          },
          {
            effectiveFrom: "2026-07-27",
            id: "same-day",
            licenseTypeId: "type-a",
            purchasedQty: 4,
            vendorAccountId: "account-1",
          },
        ],
        pendingInvites: [],
      }),
    ).toEqual([
      {
        assigned: 1,
        free: 3,
        licenseTypeId: "type-a",
        pending: 0,
        purchased: 4,
        vendorAccountId: "account-1",
      },
      {
        assigned: 1,
        free: 7,
        licenseTypeId: "type-a",
        pending: 0,
        purchased: 8,
        vendorAccountId: "account-2",
      },
    ]);
  });

  it("rejects malformed operating and capacity dates", () => {
    expect(() =>
      calculateSeatPools({
        asOf: "x2026-07-27",
        assignments: [],
        capacities: [],
        pendingInvites: [],
      }),
    ).toThrow("asOf must be an ISO date");
    expect(() =>
      calculateSeatPools({
        asOf: "2026-07-27",
        assignments: [],
        capacities: [{
          effectiveFrom: "2026-13-01suffix",
          id: "bad",
          licenseTypeId: "type-a",
          purchasedQty: 1,
          vendorAccountId: "account-1",
        }],
        pendingInvites: [],
      }),
    ).toThrow("capacity.effectiveFrom must be an ISO date");
    for (const effectiveFrom of [
      "2026-12-01suffix",
      "2026-12-01",
      "2026-07-31",
    ]) {
      const action = () =>
        calculateSeatPools({
          asOf: "2026-07-27",
          assignments: [],
          capacities: [{
            effectiveFrom,
            id: effectiveFrom,
            licenseTypeId: "type-a",
            purchasedQty: 1,
            vendorAccountId: "account-1",
          }],
          pendingInvites: [],
        });
      if (effectiveFrom.endsWith("suffix")) {
        expect(action).toThrow("capacity.effectiveFrom must be an ISO date");
      } else {
        expect(action).not.toThrow();
      }
    }
  });
});
