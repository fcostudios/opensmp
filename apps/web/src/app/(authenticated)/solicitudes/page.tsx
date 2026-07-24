// SCAFFOLD (SCR-my-requests) — generated page stub. Build the real screen per its spec: docs/screens/SCR-my-requests.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrMyRequestsPage() {
  const title = pages["solicitudes"]?.title ?? "Mis solicitudes";
  return (
    <div className="p-6" data-scaffold={"SCR-my-requests"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        {"SCR-my-requests"}
      </p>
    </div>
  );
}
