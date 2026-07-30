import { describe, expect, test } from "vitest";

import {
  resolveApprovalPageTarget,
  resolveApprovalTarget,
} from "./approval-target";

const authorizedItem = {
  requestId: "20000000-0000-4000-8000-000000000001",
};

describe("approval page target controller", () => {
  test("returns a valid target only when it is present in the authorized queue", () => {
    const otherAuthorizedItem = {
      requestId: "20000000-0000-4000-8000-000000000003",
    };
    expect(
      resolveApprovalTarget(authorizedItem.requestId, [
        otherAuthorizedItem,
        authorizedItem,
      ]),
    ).toBe(authorizedItem.requestId);
    expect(
      resolveApprovalTarget("20000000-0000-4000-8000-000000000002", [
        authorizedItem,
      ]),
    ).toBeNull();
  });

  test.each([
    undefined,
    null,
    "",
    "not-a-uuid",
    ["20000000-0000-4000-8000-000000000001"],
  ])("rejects absent or malformed request target %j", (target) => {
    expect(resolveApprovalTarget(target, [authorizedItem])).toBeNull();
  });

  test("resolves the promised page query without trusting it beyond the authorized items", async () => {
    await expect(
      resolveApprovalPageTarget(
        Promise.resolve({ requestId: authorizedItem.requestId }),
        [authorizedItem],
      ),
    ).resolves.toBe(authorizedItem.requestId);
    await expect(
      resolveApprovalPageTarget(
        Promise.resolve({
          requestId: "20000000-0000-4000-8000-000000000099",
        }),
        [authorizedItem],
      ),
    ).resolves.toBeNull();
  });
});
