// SCAFFOLD (SCR-statement-detail) — generated page stub. Build the real screen per its spec: docs/screens/SCR-statement-detail.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrStatementDetailPage() {
  const title = pages["estados-de-cuenta/[statementId]"]?.title ?? "Detalle de estado de cuenta";
  return (
    <div className="p-6" data-scaffold={"SCR-statement-detail"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        {"SCR-statement-detail"}
      </p>
    </div>
  );
}
