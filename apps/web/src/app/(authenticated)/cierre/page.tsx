// SCAFFOLD (SCR-close) — generated page stub. Build the real screen per its spec: docs/screens/SCR-close.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrClosePage() {
  const title = pages["cierre"]?.title ?? "Cierre mensual";
  return (
    <div className="p-6" data-scaffold={"SCR-close"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-close"}
      </p>
    </div>
  );
}
