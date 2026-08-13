import { describe, expect, it } from "vitest";

import {
  createVendorAccountSchema,
  updateVendorAccountSchema,
  vendorAccountModeSchema,
  vendorAccountStatusSchema,
} from "./vendor-catalog";

const validCreate = {
  vendorId: "10000000-0000-0000-0000-000000000001",
  name: "Claude Enterprise — Central",
  mode: "automated",
  vendorOrgRef: "org-central",
  contractRenewalOn: "2027-02-01",
  lowPoolFloor: 5,
} as const;

const { vendorId: _vendorId, ...validEditableFields } = validCreate;
const validUpdate = {
  ...validEditableFields,
  id: "10000000-0000-0000-0000-000000000002",
  status: "inactive",
} as const;

describe("US-025 vendor catalog contracts", () => {
  it("accepts and exactly normalizes create input", () => {
    expect(createVendorAccountSchema.parse(validCreate)).toEqual(validCreate);
    expect(
      createVendorAccountSchema.parse({
        ...validCreate,
        name: "  Claude Enterprise — Central  ",
        vendorOrgRef: "   ",
        contractRenewalOn: "",
      }),
    ).toEqual({
      ...validCreate,
      vendorOrgRef: null,
      contractRenewalOn: null,
    });
  });

  it("requires an explicit nullable renewal date", () => {
    const { contractRenewalOn: _contractRenewalOn, ...withoutRenewalDate } =
      validCreate;

    expect(createVendorAccountSchema.safeParse(withoutRenewalDate).success).toBe(
      false,
    );
    expect(
      createVendorAccountSchema.parse({
        ...validCreate,
        contractRenewalOn: null,
      }).contractRenewalOn,
    ).toBeNull();
    expect(
      createVendorAccountSchema.parse({
        ...validCreate,
        contractRenewalOn: "   ",
      }).contractRenewalOn,
    ).toBeNull();
  });

  it("trims vendor references and enforces their 200-character boundary", () => {
    expect(
      createVendorAccountSchema.parse({
        ...validCreate,
        vendorOrgRef: "  org-central  ",
      }).vendorOrgRef,
    ).toBe("org-central");
    expect(
      createVendorAccountSchema.parse({
        ...validCreate,
        vendorOrgRef: `  ${"r".repeat(200)}  `,
      }).vendorOrgRef,
    ).toHaveLength(200);
    expect(
      createVendorAccountSchema.safeParse({
        ...validCreate,
        vendorOrgRef: "r".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("rejects create input without an explicit vendor reference", () => {
    const { vendorOrgRef: _vendorOrgRef, ...withoutVendorOrgRef } = validCreate;

    expect(createVendorAccountSchema.safeParse(withoutVendorOrgRef).success).toBe(
      false,
    );
    expect(
      createVendorAccountSchema.safeParse({
        ...validCreate,
        vendorOrgRef: undefined,
      }).success,
    ).toBe(false);
  });

  it("rejects update input without an explicit vendor reference", () => {
    const { vendorOrgRef: _vendorOrgRef, ...withoutVendorOrgRef } = validUpdate;

    expect(updateVendorAccountSchema.safeParse(withoutVendorOrgRef).success).toBe(
      false,
    );
    expect(
      updateVendorAccountSchema.safeParse({
        ...validUpdate,
        vendorOrgRef: undefined,
      }).success,
    ).toBe(false);
  });

  it.each(["not-a-uuid", "10000000-0000-0000-0000-00000000000z"])(
    "rejects invalid vendor ID %s",
    (vendorId) => {
      expect(
        createVendorAccountSchema.safeParse({ ...validCreate, vendorId }).success,
      ).toBe(false);
    },
  );

  it.each(["", "   ", "n".repeat(201)])("rejects invalid account name", (name) => {
    expect(createVendorAccountSchema.safeParse({ ...validCreate, name }).success).toBe(
      false,
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid low-pool floor %s",
    (lowPoolFloor) => {
      expect(
        createVendorAccountSchema.safeParse({ ...validCreate, lowPoolFloor }).success,
      ).toBe(false);
    },
  );

  it("accepts the PostgreSQL int4 maximum and rejects the next integer", () => {
    expect(
      createVendorAccountSchema.parse({
        ...validCreate,
        lowPoolFloor: 2_147_483_647,
      }).lowPoolFloor,
    ).toBe(2_147_483_647);
    expect(
      createVendorAccountSchema.safeParse({
        ...validCreate,
        lowPoolFloor: 2_147_483_648,
      }).success,
    ).toBe(false);
  });

  it.each(["2027-02-29", "2027-02-01T00:00:00.000Z"])(
    "rejects invalid renewal date %s",
    (contractRenewalOn) => {
      expect(
        createVendorAccountSchema.safeParse({
          ...validCreate,
          contractRenewalOn,
        }).success,
      ).toBe(false);
    },
  );

  it("rejects unknown modes and statuses", () => {
    expect(vendorAccountModeSchema.safeParse("manual").success).toBe(false);
    expect(vendorAccountStatusSchema.safeParse("deleted").success).toBe(false);
    expect(
      createVendorAccountSchema.safeParse({ ...validCreate, mode: "manual" }).success,
    ).toBe(false);
    expect(
      updateVendorAccountSchema.safeParse({
        ...validUpdate,
        status: "deleted",
      }).success,
    ).toBe(false);
  });

  it("accepts every supported mode and update status in complete inputs", () => {
    expect(
      createVendorAccountSchema.parse({
        ...validCreate,
        mode: "orchestration",
      }).mode,
    ).toBe("orchestration");
    expect(
      updateVendorAccountSchema.parse({
        ...validUpdate,
        mode: "orchestration",
        status: "active",
      }),
    ).toEqual({
      ...validUpdate,
      mode: "orchestration",
      status: "active",
    });
    expect(updateVendorAccountSchema.parse(validUpdate).status).toBe("inactive");
  });

  it("rejects server-owned status on create input", () => {
    expect(
      createVendorAccountSchema.safeParse({ ...validCreate, status: "active" }).success,
    ).toBe(false);
  });

  it("requires a valid account ID on update and omits vendor ID", () => {
    expect(updateVendorAccountSchema.parse(validUpdate)).toEqual(validUpdate);
    expect(updateVendorAccountSchema.safeParse({ ...validUpdate, id: undefined }).success).toBe(
      false,
    );
    expect(updateVendorAccountSchema.safeParse({ ...validUpdate, id: "invalid" }).success).toBe(
      false,
    );
    expect(
      updateVendorAccountSchema.safeParse({ ...validUpdate, vendorId: validCreate.vendorId })
        .success,
    ).toBe(false);
  });

  it("rejects unexpected create and update keys", () => {
    expect(
      createVendorAccountSchema.safeParse({ ...validCreate, unexpected: true }).success,
    ).toBe(false);
    expect(
      updateVendorAccountSchema.safeParse({
        ...validUpdate,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("publishes the exact schemas from the public barrel", async () => {
    const publicContracts = await import("./index");
    expect(publicContracts.createVendorAccountSchema).toBe(createVendorAccountSchema);
    expect(publicContracts.updateVendorAccountSchema).toBe(updateVendorAccountSchema);
    expect(publicContracts.vendorAccountModeSchema).toBe(vendorAccountModeSchema);
    expect(publicContracts.vendorAccountStatusSchema).toBe(vendorAccountStatusSchema);
  });
});
