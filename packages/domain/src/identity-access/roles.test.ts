import { expect, test } from "vitest";

import { ROLE_CAPABILITIES } from "./roles";

test("role capabilities are exact sets rather than a privilege hierarchy", () => {
  expect(ROLE_CAPABILITIES).toEqual({
    group_admin: [
      "company:read",
      "company:write",
      "finance:read",
      "finance:close",
      "request:create",
      "request:approve",
      "audit:read",
      "admin:manage",
    ],
    central_finance: ["finance:read", "finance:close"],
    employee: ["request:create"],
    approver: ["company:read", "request:create", "request:approve"],
    company_finance: ["company:read", "finance:read"],
    viewer: ["company:read"],
  });
});
