// SCAFFOLD (SCR-usage) — generated page stub. Build the real screen per its spec: docs/screens/SCR-usage.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrUsagePage() {
  const title = pages["uso"]?.title ?? "Actividad y uso";
  return (
    <div className="p-6" data-scaffold={"SCR-usage"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-usage"}
      </p>
    </div>
  );
}
