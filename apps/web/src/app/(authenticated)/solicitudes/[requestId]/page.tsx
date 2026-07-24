// SCAFFOLD (SCR-request-detail) — generated page stub. Build the real screen per its spec: docs/screens/SCR-request-detail.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrRequestDetailPage() {
  const title = pages["solicitudes/[requestId]"]?.title ?? "Detalle de solicitud";
  return (
    <div className="p-6" data-scaffold={"SCR-request-detail"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        {"SCR-request-detail"}
      </p>
    </div>
  );
}
