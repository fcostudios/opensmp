// SCAFFOLD (SCR-access-denied) — generated page stub. Build the real screen per its spec: docs/screens/SCR-access-denied.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrAccessDeniedPage() {
  const title = pages["acceso-denegado"]?.title ?? "Acceso denegado";
  return (
    <div className="p-6" data-scaffold={"SCR-access-denied"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        {"SCR-access-denied"}
      </p>
    </div>
  );
}
