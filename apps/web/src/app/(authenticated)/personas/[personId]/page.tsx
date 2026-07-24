// SCAFFOLD (SCR-person-detail) — generated page stub. Build the real screen per its spec: docs/screens/SCR-person-detail.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrPersonDetailPage() {
  const title = pages["personas/[personId]"]?.title ?? "Detalle de persona";
  return (
    <div className="p-6" data-scaffold={"SCR-person-detail"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        {"SCR-person-detail"}
      </p>
    </div>
  );
}
