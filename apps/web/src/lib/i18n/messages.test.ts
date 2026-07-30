import { describe, expect, test } from "vitest";

import { notificationCatalogs } from "@smp/notifications/catalog";

import enUSAppMessages from "../../../messages/en-US.json";
import esECAppMessages from "../../../messages/es-EC.json";
import { loadAppMessages } from "./messages";

describe("server next-intl message composition", () => {
  test("keeps lifecycle status vocabulary out of the hand-maintained app catalogs", () => {
    expect(enUSAppMessages).not.toHaveProperty("status");
    expect(esECAppMessages).not.toHaveProperty("status");
  });

  test.each(["en-US", "es-EC"] as const)(
    "loads the exact canonical 12-state and lifecycle templates into the %s runtime",
    async (locale) => {
      const messages = await loadAppMessages(locale);

      expect(messages._locale).toBe(locale);
      expect(messages.status).toBe(notificationCatalogs[locale].status);
      expect(messages.lifecycle).toBe(notificationCatalogs[locale].lifecycle);
      expect(Object.keys(messages.status)).toHaveLength(12);
      expect(messages.status).toEqual(notificationCatalogs[locale].status);
      expect(messages.lifecycle).toEqual(
        notificationCatalogs[locale].lifecycle,
      );
    },
  );

  test.each([null, "fr-FR", "EN-us"])(
    "falls back unsupported runtime locale %j to the canonical Ecuadorian Spanish catalog",
    async (locale) => {
      const messages = await loadAppMessages(locale);

      expect(messages.status).toBe(notificationCatalogs["es-EC"].status);
      expect(messages.lifecycle).toBe(
        notificationCatalogs["es-EC"].lifecycle,
      );
    },
  );
});
