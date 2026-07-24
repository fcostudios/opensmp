"use client";

import { useMemo } from "react";
import enUs from "./en-US.json";

const LOCALES: Record<string, Record<string, unknown>> = {
          "en-US": enUs,
};

const DEFAULT_LOCALE = "en-US";

function detectLocale(): string {
    return DEFAULT_LOCALE;
}

/** Returns the active locale dictionary. Priority: user pref → browser → project primary. */
export function useLocale() {
    return useMemo(() => {
        const locale = detectLocale();
        return {
            locale,
            t: LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE],
        };
    }, []);
}

/** Get a nested translation key. e.g. getTranslation(t, "nav.dashboard") */
export function getTranslation(dict: Record<string, unknown>, key: string): string {
    const parts = key.split(".");
    let current: unknown = dict;
    for (const part of parts) {
        if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
            current = (current as Record<string, unknown>)[part];
        } else {
            return key; // fallback to key if not found
        }
    }
    return typeof current === "string" ? current : key;
}
