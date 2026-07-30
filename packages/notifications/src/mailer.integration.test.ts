import { beforeEach, describe, expect, it } from "vitest";

import { renderLifecycleNotification } from "./catalog.js";
import { createSmtpMailer } from "./mailer.js";

const smtpUrl = process.env.MAILPIT_TEST_SMTP_URL;
const apiOrigin = process.env.MAILPIT_TEST_API_ORIGIN;

describe.runIf(smtpUrl && apiOrigin)("US-016 real Mailpit SMTP boundary", () => {
  beforeEach(async () => {
    const response = await fetch(`${apiOrigin}/api/v1/messages`, {
      method: "DELETE",
    });
    expect(response.ok).toBe(true);
  });

  it("delivers sender, recipient, bilingual body, and scoped deep link through Mailpit", async () => {
    const rendered = renderLifecycleNotification(
      "es",
      "new_request_to_approver",
      {
        companyName: "Compañía Norte",
        publicOrigin: "https://ledger.example.test",
        requestId: "11111111-1111-4111-8111-111111111111",
        requestNo: "SOL-016",
        requesterName: "Ana Torres",
        state: "pending_approval",
      },
    );
    const mailer = createSmtpMailer(smtpUrl!);

    const delivery = await mailer.send({
      from: "ledger@corporativo.example",
      html: rendered.html,
      subject: rendered.subject,
      text: rendered.text,
      to: ["aprobador@corporativo.example"],
    });

    expect(delivery.accepted).toEqual(["aprobador@corporativo.example"]);
    const listingResponse = await fetch(`${apiOrigin}/api/v1/messages`);
    expect(listingResponse.ok).toBe(true);
    const listing = (await listingResponse.json()) as {
      messages: Array<{
        From: { Address: string };
        ID: string;
        Subject: string;
        To: Array<{ Address: string }>;
      }>;
    };
    expect(listing.messages).toHaveLength(1);
    const summary = listing.messages[0]!;
    expect(summary.From.Address).toBe("ledger@corporativo.example");
    expect(summary.To.map(({ Address }) => Address)).toEqual([
      "aprobador@corporativo.example",
    ]);
    expect(summary.Subject).toBe("Nueva solicitud por aprobar: SOL-016");

    const detailResponse = await fetch(
      `${apiOrigin}/api/v1/message/${summary.ID}`,
    );
    expect(detailResponse.ok).toBe(true);
    const detail = (await detailResponse.json()) as {
      HTML: string;
      Text: string;
    };
    expect(detail.Text).toContain("Pendiente de aprobación");
    expect(detail.HTML).toContain(
      "https://ledger.example.test/aprobaciones?requestId=11111111-1111-4111-8111-111111111111",
    );
  });
});
