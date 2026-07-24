// SCAFFOLD (SCR-register) — generated page stub. Build the real screen per its spec: docs/screens/SCR-register.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrRegisterPage() {
  const title = pages["registro"]?.title ?? "Registro";
  return (
    <div className="p-6" data-scaffold={"SCR-register"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-register"}
      </p>
    </div>
  );
}
