// SCAFFOLD (SCR-settings) — generated page stub. Build the real screen per its spec: docs/screens/SCR-settings.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrSettingsPage() {
  const title = pages["configuracion"]?.title ?? "Configuración";
  return (
    <div className="p-6" data-scaffold={"SCR-settings"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-settings"}
      </p>
    </div>
  );
}
