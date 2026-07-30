import { createHash } from "node:crypto";

import nodemailer from "nodemailer";

export type NotificationMessage = {
  from: string;
  to: readonly string[];
  subject: string;
  text: string;
  html: string;
  /** Stable across retries so SMTP receivers can suppress duplicate acceptance. */
  messageId?: string;
};

export interface NotificationMailer {
  send(message: NotificationMessage): Promise<{
    providerMessageId: string;
    accepted: readonly string[];
  }>;
}

/**
 * SMTP delivery is at-least-once: a worker can crash after provider acceptance
 * but before the succeeded journal row commits. A stable RFC Message-ID gives
 * downstream SMTP systems a deterministic duplicate-suppression identity.
 */
export function createStableMessageId(dedupeKey: string): string {
  if (!dedupeKey.trim()) throw new TypeError("dedupeKey is required");
  const digest = createHash("sha256").update(dedupeKey).digest("hex");
  return `<${digest}@ledger.local>`;
}

export function createSmtpMailer(smtpUrl: string): NotificationMailer {
  if (!smtpUrl.trim()) throw new TypeError("smtpUrl is required");
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message) {
      validateMessage(message);
      const result = await transport.sendMail({
        ...message,
        to: [...message.to],
      });
      return {
        accepted: result.accepted.map(String),
        providerMessageId: result.messageId,
      };
    },
  };
}

function validateMessage(message: NotificationMessage): void {
  if (!message.from.trim()) throw new TypeError("notification from is required");
  if (message.to.length === 0 || message.to.some((address) => !address.trim())) {
    throw new TypeError("notification recipients are required");
  }
  if (!message.subject.trim() || !message.text.trim() || !message.html.trim()) {
    throw new TypeError("rendered notification content is required");
  }
}
