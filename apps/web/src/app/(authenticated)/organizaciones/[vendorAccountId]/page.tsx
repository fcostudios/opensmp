// SCAFFOLD (SCR-vendor-account-detail) — generated page stub. Build the real screen per its spec: docs/screens/SCR-vendor-account-detail.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrVendorAccountDetailPage() {
  const title = pages["organizaciones/[vendorAccountId]"]?.title ?? "Detalle de organización";
  return (
    <div className="p-6" data-scaffold={"SCR-vendor-account-detail"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-vendor-account-detail"}
      </p>
    </div>
  );
}
