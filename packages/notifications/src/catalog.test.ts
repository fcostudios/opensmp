import { describe, expect, it } from "vitest";

import {
  notificationCatalogs,
  renderApprovalAgingNotification,
  renderAlertNotification,
  renderLifecycleNotification,
} from "./catalog.js";

describe("US-017 approval aging catalog", () => {
  const input = {
    approverName: `Ana <Approver>`,
    companyName: `Andes & Norte`,
    requestNo: `REQ-"017"`,
  };

  it.each([
    ["reminder", "Approval reminder", "24 business hours"],
    ["escalation", "Approval escalation", "48 business hours"],
  ] as const)(
    "renders the English %s with request, company, and approver context",
    (stage, expectedSubject, expectedHours) => {
      const rendered = renderApprovalAgingNotification(
        "en-US",
        stage,
        input,
      );

      expect(rendered.subject).toContain(expectedSubject);
      expect(rendered.text).toContain(expectedHours);
      expect(rendered.text).toContain(input.requestNo);
      expect(rendered.text).toContain(input.companyName);
      expect(rendered.text).toContain(input.approverName);
      expect(rendered.html).toContain("Ana &lt;Approver&gt;");
      expect(rendered.html).toContain("Andes &amp; Norte");
      expect(rendered.html).not.toContain("<Approver>");
    },
  );

  it("renders the escalation from the Ecuadorian Spanish catalog", () => {
    const rendered = renderApprovalAgingNotification(
      "es-EC",
      "escalation",
      input,
    );

    expect(rendered.subject).toContain("Escalación de aprobación");
    expect(rendered.text).toContain("48 horas hábiles");
  });

  it("uses a localized current-approver label when no approver is assigned", () => {
    expect(
      renderApprovalAgingNotification("en-US", "escalation", {
        ...input,
        approverName: "   ",
      }).text,
    ).toContain("no current company approver");
    expect(
      renderApprovalAgingNotification("es-EC", "escalation", {
        ...input,
        approverName: "   ",
      }).text,
    ).toContain("sin aprobador actual de la compañía");
  });
});

describe("US-042 bilingual notification catalogs", () => {
  it("renders complete, distinct English and Ecuadorian Spanish alert content", () => {
    const subject = { requestId: "REQ-042" };
    const english = renderAlertNotification("en-US", "approval_aging", subject);
    const spanish = renderAlertNotification("es-EC", "approval_aging", subject);

    expect(english).toEqual({
      html: "<p>Ledger detected <strong>approval_aging</strong> for REQ-042.</p><p>Open Ledger to review it.</p>",
      subject: "Ledger alert: approval_aging",
      text: "Ledger detected approval_aging for REQ-042. Open Ledger to review it.",
    });
    expect(spanish).toEqual({
      html: "<p>Ledger detectó <strong>approval_aging</strong> para REQ-042.</p><p>Abre Ledger para revisarla.</p>",
      subject: "Alerta de Ledger: approval_aging",
      text: "Ledger detectó approval_aging para REQ-042. Abre Ledger para revisarla.",
    });
    expect(notificationCatalogs["en-US"].lifecycle.submission.subject).not.toBe(
      notificationCatalogs["es-EC"].lifecycle.submission.subject,
    );
  });

  it("rejects a missing stable subject identity", () => {
    expect(() =>
      renderAlertNotification(
        "en-US",
        "low_pool",
        {} as { vendorAccountId: string },
      ),
    ).toThrow("alert subject identity is required");
  });
});

describe("US-016 lifecycle notification catalog", () => {
  const input = {
    companyName: `Corporativo <Central>`,
    publicOrigin: "https://ledger.example.test",
    requestId: "11111111-1111-4111-8111-111111111111",
    requestNo: `SOL-016 <script>alert("x")</script>`,
    requesterName: `Ana & "Equipo"`,
    state: "pending_approval" as const,
  };

  it.each([
    ["es", "Solicitud recibida", "Pendiente de aprobación"],
    ["es-EC", "Solicitud recibida", "Pendiente de aprobación"],
    ["en", "Request received", "Pending approval"],
    ["en-US", "Request received", "Pending approval"],
    [null, "Solicitud recibida", "Pendiente de aprobación"],
    ["unsupported", "Solicitud recibida", "Pendiente de aprobación"],
  ])(
    "renders submission with locale %s and Spanish fallback",
    (locale, expectedSubject, expectedState) => {
      const rendered = renderLifecycleNotification(
        locale,
        "submission",
        input,
      );

      expect(rendered.subject).toContain(expectedSubject);
      expect(rendered.text).toContain(expectedState);
      expect(rendered.text).toContain(
        "https://ledger.example.test/solicitudes/11111111-1111-4111-8111-111111111111",
      );
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("Ana &amp; &quot;Equipo&quot;");
    },
  );

  it("renders all four lifecycle messages with scoped links and the shared state vocabulary", () => {
    const submission = renderLifecycleNotification("es", "submission", input);
    const approver = renderLifecycleNotification(
      "es",
      "new_request_to_approver",
      input,
    );
    const decision = renderLifecycleNotification("en", "decision", {
      ...input,
      state: "rejected",
    });
    const completed = renderLifecycleNotification(
      "en",
      "provisioning_complete",
      { ...input, state: "active" },
    );

    expect(submission.text).toContain("Pendiente de aprobación");
    expect(approver.text).toContain(
      "https://ledger.example.test/aprobaciones?requestId=11111111-1111-4111-8111-111111111111",
    );
    expect(decision.text).toContain("Rejected");
    expect(completed.text).toContain("Active");
    expect(completed.text).toContain("getting started");
    expect(Object.keys(notificationCatalogs["es-EC"].status)).toHaveLength(12);
    expect(Object.keys(notificationCatalogs["en-US"].status)).toEqual(
      Object.keys(notificationCatalogs["es-EC"].status),
    );
  });

  it("rejects a public origin that could redirect a deep link off-site", () => {
    expect(() =>
      renderLifecycleNotification("es", "submission", {
        ...input,
        publicOrigin: "javascript:alert(1)",
      }),
    ).toThrow("publicOrigin");
    expect(() =>
      renderLifecycleNotification("es", "submission", {
        ...input,
        publicOrigin: "https://ledger.example.test/path",
      }),
    ).toThrow("publicOrigin");
    expect(() =>
      renderLifecycleNotification("es", "submission", {
        ...input,
        publicOrigin: "not a URL",
      }),
    ).toThrow("publicOrigin");
    expect(() =>
      renderLifecycleNotification("es", "submission", {
        ...input,
        publicOrigin: "ftp://ledger.example.test",
      }),
    ).toThrow("publicOrigin");
    expect(() =>
      renderLifecycleNotification("es", "submission", {
        ...input,
        publicOrigin: "https://user@ledger.example.test",
      }),
    ).toThrow("publicOrigin");
    expect(() =>
      renderLifecycleNotification("es", "submission", {
        ...input,
        publicOrigin: "https://:secret@ledger.example.test",
      }),
    ).toThrow("publicOrigin");
    expect(
      renderLifecycleNotification("es", "submission", {
        ...input,
        publicOrigin: "http://ledger.example.test",
        requesterName: "Ana's Team",
      }).html,
    ).toContain("Ana&#39;s Team");
  });
});
