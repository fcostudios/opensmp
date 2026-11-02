"use client";
import messages from "@/lib/i18n/en-US.json";
export default function ErrorState({ reset }: { reset: () => void }) { return <div className="space-y-4 p-6"><p role="alert">{messages.close.loadError}</p><button onClick={reset}>{messages.close.retry}</button></div>; }
