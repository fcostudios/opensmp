import { getLocale } from "next-intl/server";
import { loadAppMessages } from "@/lib/i18n/messages";
export default async function Loading() {
  const messages = await loadAppMessages(await getLocale());
  return <p role="status" className="p-6">{messages.statements.loading}</p>;
}
