// SCAFFOLD (SCR-people) — generated page stub. Build the real screen per its spec: docs/screens/SCR-people.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrPeoplePage() {
  const title = pages["personas"]?.title ?? "Personas";
  return (
    <div className="p-6" data-scaffold={"SCR-people"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-people"}
      </p>
    </div>
  );
}
