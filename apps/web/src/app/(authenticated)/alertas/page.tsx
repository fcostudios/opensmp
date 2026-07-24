// SCAFFOLD (SCR-alerts) — generated page stub. Build the real screen per its spec: docs/screens/SCR-alerts.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrAlertsPage() {
  const title = pages["alertas"]?.title ?? "Alertas";
  return (
    <div className="p-6" data-scaffold={"SCR-alerts"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-alerts"}
      </p>
    </div>
  );
}
