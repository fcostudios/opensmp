import { describe, expect, test } from "vitest";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { canDecideRequestDetail } from "./request-detail-decision-policy";

const companyA = "13000000-0000-0000-0000-000000000006";
const companyB = "13000000-0000-0000-0000-000000000007";

function authorization(
  input: Partial<LedgerAuthorization>,
): LedgerAuthorization {
  return {
    companyGrants: [],
    companyIds: [],
    employeeCompanyId: null,
    globalRole: null,
    idpSubject: "subject",
    roles: [],
    userAccountId: "user",
    userId: "user",
    ...input,
  };
}

describe("request detail decision visibility", () => {
  test("allows a company approver only for its pending request", () => {
    const approver = authorization({
      companyGrants: [{ companyId: companyA, role: "approver" }],
    });

    expect(canDecideRequestDetail(approver, companyA, "pending_approval")).toBe(
      true,
    );
    expect(canDecideRequestDetail(approver, companyB, "pending_approval")).toBe(
      false,
    );
    expect(canDecideRequestDetail(approver, companyA, "approved")).toBe(false);
  });

  test("allows group admin and denies employee and central finance", () => {
    expect(
      canDecideRequestDetail(
        authorization({ globalRole: "group_admin" }),
        companyA,
        "pending_approval",
      ),
    ).toBe(true);
    expect(
      canDecideRequestDetail(
        authorization({
          employeeCompanyId: companyA,
          globalRole: null,
        }),
        companyA,
        "pending_approval",
      ),
    ).toBe(false);
    expect(
      canDecideRequestDetail(
        authorization({ globalRole: "central_finance" }),
        companyA,
        "pending_approval",
      ),
    ).toBe(false);
  });
});
