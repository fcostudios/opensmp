// SCAFFOLD (SCR-admin-dashboard) — generated page stub. Build the real screen per its spec: docs/screens/SCR-admin-dashboard.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrAdminDashboardPage() {
  const title = pages["panel"]?.title ?? "Panel general";
  return (
    <div className="p-6" data-scaffold={"SCR-admin-dashboard"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-admin-dashboard"}
      </p>
    </div>
  );
}
