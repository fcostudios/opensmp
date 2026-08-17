import { describe, expect, it, vi } from "vitest";

import { ackAlertPolicy } from "./ack-alert-policy";
import type { LedgerAuthorization } from "../identity-access/authorization";

const at = new Date("2026-08-15T12:00:00.000Z");
const eventId = "00000000-0000-4000-8000-000000004301";
const actor = "00000000-0000-4000-8000-000000004401";

function admin(globalRole: LedgerAuthorization["globalRole"]): LedgerAuthorization {
  return {
    companyGrants: [], companyIds: [], employeeCompanyId: null,
    globalRole, idpSubject: "subject", roles: [], userAccountId: actor, userId: actor,
  } as unknown as LedgerAuthorization;
}

describe("ackAlertPolicy", () => {
  it("acknowledges for a group admin", async () => {
    const acknowledge = vi.fn().mockResolvedValue({
      status: "acknowledged", acknowledgedBy: actor, acknowledgedAt: at,
    });
    const result = await ackAlertPolicy(
      { authorization: admin("group_admin"), acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({
      ok: true, acknowledgedBy: actor, acknowledgedAt: at.toISOString(),
    });
  });

  it("rejects a non group admin without touching the repository", async () => {
    const acknowledge = vi.fn();
    const result = await ackAlertPolicy(
      { authorization: admin("central_finance"), acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller without touching the repository", async () => {
    const acknowledge = vi.fn();
    const result = await ackAlertPolicy(
      { authorization: null, acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before authorizing the repository call", async () => {
    const acknowledge = vi.fn();
    const result = await ackAlertPolicy(
      { authorization: admin("group_admin"), acknowledge, now: () => at },
      { alertEventId: "al-001" },
    );
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("reports an out-of-scope alert as not found", async () => {
    const acknowledge = vi.fn().mockResolvedValue({ status: "not_found" });
    const result = await ackAlertPolicy(
      { authorization: admin("group_admin"), acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("treats a replayed acknowledgment as success with the original acknowledger", async () => {
    const acknowledge = vi.fn().mockResolvedValue({
      status: "already_acknowledged", acknowledgedBy: actor, acknowledgedAt: at,
    });
    const result = await ackAlertPolicy(
      { authorization: admin("group_admin"), acknowledge, now: () => at },
      { alertEventId: eventId },
    );
    expect(result).toEqual({
      ok: true, acknowledgedBy: actor, acknowledgedAt: at.toISOString(),
    });
  });
});
