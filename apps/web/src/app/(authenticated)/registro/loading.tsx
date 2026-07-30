import { getTranslations } from "next-intl/server";

export default async function RegisterLoading() {
  const t = await getTranslations("register");
  return <main className="p-6" data-testid="register_loading" role="status" aria-live="polite">{t("loading")}</main>;
}
