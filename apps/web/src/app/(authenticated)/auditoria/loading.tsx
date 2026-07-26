import { getTranslations } from "next-intl/server";

export default async function AuditLoading() {
  const t = await getTranslations("audit");
  return (
    <div
      aria-live="polite"
      className="p-6 text-text-secondary"
      data-testid="audit_loading"
      role="status"
    >
      {t("loading")}
    </div>
  );
}
