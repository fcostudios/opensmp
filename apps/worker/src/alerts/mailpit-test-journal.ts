export interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

export function createMailpitTestJournal(
  apiOrigin: string,
  ownedRecipients: readonly string[],
) {
  const owned = new Set(ownedRecipients);

  async function messages(): Promise<MailpitMessageSummary[]> {
    const response = await fetch(`${apiOrigin}/api/v1/messages?limit=500`);
    if (!response.ok) {
      throw new Error(`Mailpit message listing failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      messages: MailpitMessageSummary[];
    };
    return body.messages.filter(({ To }) =>
      To.some(({ Address }) => owned.has(Address))
    );
  }

  async function clear(): Promise<void> {
    const IDs = (await messages()).map(({ ID }) => ID);
    if (IDs.length === 0) return;

    const response = await fetch(`${apiOrigin}/api/v1/messages`, {
      body: JSON.stringify({ IDs }),
      headers: { "content-type": "application/json" },
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`Mailpit message cleanup failed: ${response.status}`);
    }
  }

  return { clear, messages };
}
