import { getTranslations } from "next-intl/server";

export default async function PoolsLoading() {
  const t = await getTranslations("pools");
  return (
    <section
      aria-busy="true"
      aria-label={t("loading")}
      className="m-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      {[0, 1, 2].map((slot) => (
        <div
          className="h-64 animate-pulse rounded bg-surface-muted"
          key={slot}
        />
      ))}
    </section>
  );
}
