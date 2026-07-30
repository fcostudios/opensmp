import { getTranslations } from "next-intl/server";

export default async function PeopleLoading() {
  const t = await getTranslations("people");
  return (
    <div
      aria-live="polite"
      className="p-6 text-text-secondary"
      data-testid="people_loading"
      role="status"
    >
      {t("loading")}
    </div>
  );
}
