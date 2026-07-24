// SCAFFOLD (SCR-users-roles) — generated page stub. Build the real screen per its spec: docs/screens/SCR-users-roles.json
import messages from "@/lib/i18n/en-US.json";

const pages = (messages as { pages?: Record<string, { title?: string }> }).pages ?? {};

export default function ScrUsersRolesPage() {
  const title = pages["usuarios"]?.title ?? "Usuarios y roles";
  return (
    <div className="p-6" data-scaffold={"SCR-users-roles"}>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-text-secondary">
        {"SCR-users-roles"}
      </p>
    </div>
  );
}
