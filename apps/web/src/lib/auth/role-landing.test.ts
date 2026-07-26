import { describe, expect, test } from "vitest";

import type { LedgerSessionUser } from "./auth-types";
import { roleLanding } from "./role-landing";

function user(
  overrides: Partial<LedgerSessionUser> = {},
): LedgerSessionUser {
  return {
    id: "00000000-0000-0000-0000-000000000401",
    idpSubject: "keycloak-subject",
    email: "user@corporativo.example",
    name: "Ledger User",
    globalRole: null,
    companyGrants: [],
    uiLanguage: null,
    ...overrides,
  };
}

describe("roleLanding", () => {
  test.each([
    ["employee", user(), "/solicitudes"],
    [
      "approver",
      user({
        companyGrants: [
          {
            companyId: "00000000-0000-0000-0000-000000000411",
            role: "approver",
          },
        ],
      }),
      "/aprobaciones",
    ],
    [
      "company finance",
      user({
        companyGrants: [
          {
            companyId: "00000000-0000-0000-0000-000000000411",
            role: "finance",
          },
        ],
      }),
      "/estados-de-cuenta",
    ],
    [
      "central finance",
      user({ globalRole: "central_finance" }),
      "/cierre",
    ],
    [
      "group admin",
      user({ globalRole: "group_admin" }),
      "/panel",
    ],
    [
      "viewer",
      user({
        companyGrants: [
          {
            companyId: "00000000-0000-0000-0000-000000000411",
            role: "viewer",
          },
        ],
      }),
      "/companias/00000000-0000-0000-0000-000000000411",
    ],
  ] as const)("lands %s on its exact destination", (_kind, identity, expected) => {
    expect(roleLanding(identity)).toBe(expected);
  });

  test("uses exact privilege precedence and deterministically chooses the first viewer company", () => {
    expect(
      roleLanding(
        user({
          companyGrants: [
            {
              companyId: "00000000-0000-0000-0000-000000000499",
              role: "viewer",
            },
            {
              companyId: "00000000-0000-0000-0000-000000000412",
              role: "finance",
            },
            {
              companyId: "00000000-0000-0000-0000-000000000411",
              role: "approver",
            },
            {
              companyId: "00000000-0000-0000-0000-000000000401",
              role: "viewer",
            },
          ],
        }),
      ),
    ).toBe("/aprobaciones");

    expect(
      roleLanding(
        user({
          companyGrants: [
            {
              companyId: "00000000-0000-0000-0000-000000000499",
              role: "viewer",
            },
            {
              companyId: "00000000-0000-0000-0000-000000000401",
              role: "viewer",
            },
          ],
        }),
      ),
    ).toBe("/companias/00000000-0000-0000-0000-000000000401");
  });

  test("global roles take precedence over every company grant", () => {
    const grants: LedgerSessionUser["companyGrants"] = [
      {
        companyId: "00000000-0000-0000-0000-000000000411",
        role: "approver",
      },
    ];

    expect(
      roleLanding(user({ globalRole: "central_finance", companyGrants: grants })),
    ).toBe("/cierre");
    expect(
      roleLanding(user({ globalRole: "group_admin", companyGrants: grants })),
    ).toBe("/panel");
  });
});
