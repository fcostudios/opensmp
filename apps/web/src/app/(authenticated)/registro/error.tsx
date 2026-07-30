"use client";

import { useTranslations } from "next-intl";

export default function RegisterError({ reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  const t = useTranslations("register");
  return <main className="p-6" data-testid="register_error" role="alert"><p>{t("error")}</p><button className="mt-4 min-h-11 rounded border border-border px-4" onClick={reset} type="button">{t("retry")}</button></main>;
}
