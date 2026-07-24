// SCAFFOLD (SCR-new-request) — generated page stub. Build the real screen per its spec: docs/screens/SCR-new-request.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrNewRequestPage() {
  const title = pages["solicitudes/nueva"]?.title ?? "Nueva solicitud";
  return (
    <div className="p-6" data-scaffold={"SCR-new-request"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-new-request"}
      </p>
    </div>
  );
}
