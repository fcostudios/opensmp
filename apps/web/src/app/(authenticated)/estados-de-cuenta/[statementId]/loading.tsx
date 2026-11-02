"use client";
import { useTranslations } from "next-intl";
export default function Loading() {
  const t = useTranslations("statementDetail");
  return <p role="status" className="p-6">{t("loading")}</p>;
}
