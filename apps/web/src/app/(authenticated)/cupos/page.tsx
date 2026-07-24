// SCAFFOLD (SCR-pools) — generated page stub. Build the real screen per its spec: docs/screens/SCR-pools.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrPoolsPage() {
  const title = pages["cupos"]?.title ?? "Cupos";
  return (
    <div className="p-6" data-scaffold={"SCR-pools"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-pools"}
      </p>
    </div>
  );
}
