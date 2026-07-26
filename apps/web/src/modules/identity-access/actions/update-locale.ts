"use server";

import { refresh } from "next/cache";

import { type UpdateLocaleInput } from "@smp/contracts";

import { auth } from "@/lib/auth/auth-config";
import { localeService } from "../locale";

export async function updateLocale(input: UpdateLocaleInput): Promise<void> {
  const session = await auth();
  await localeService.updateLocale(session?.user?.id ?? null, input);
  refresh();
}
