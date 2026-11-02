"use client";
import messages from "@/lib/i18n/en-US.json";
export default function Error({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-4 p-6"><p>{messages.rates.loadError}</p><button onClick={reset}>{messages.rates.retry}</button></div>;
}
