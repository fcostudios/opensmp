// SCAFFOLD (SCR-companies) — generated page stub. Build the real screen per its spec: docs/screens/SCR-companies.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrCompaniesPage() {
  const title = pages["companias"]?.title ?? "Compañías";
  return (
    <div className="p-6" data-scaffold={"SCR-companies"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        {"SCR-companies"}
      </p>
    </div>
  );
}
