// SCAFFOLD (SCR-exceptions) — generated page stub. Build the real screen per its spec: docs/screens/SCR-exceptions.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrExceptionsPage() {
  const title = pages["excepciones"]?.title ?? "Excepciones";
  return (
    <div className="p-6" data-scaffold={"SCR-exceptions"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-exceptions"}
      </p>
    </div>
  );
}
