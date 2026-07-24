// SCAFFOLD (SCR-login) — generated page stub. Build the real screen per its spec: docs/screens/SCR-login.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrLoginPage() {
  const title = pages["login"]?.title ?? "Ingresar";
  return (
    <div className="p-6" data-scaffold={"SCR-login"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-login"}
      </p>
    </div>
  );
}
