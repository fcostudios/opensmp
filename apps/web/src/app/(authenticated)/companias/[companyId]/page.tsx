// SCAFFOLD (SCR-company-detail) — generated page stub. Build the real screen per its spec: docs/screens/SCR-company-detail.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrCompanyDetailPage() {
  const title = pages["companias/[companyId]"]?.title ?? "Detalle de compañía";
  return (
    <div className="p-6" data-scaffold={"SCR-company-detail"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-company-detail"}
      </p>
    </div>
  );
}
