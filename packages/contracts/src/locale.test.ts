import { describe, expect, test } from "vitest";

import {
  appLocaleSchema,
  storedLocaleSchema,
  toAppLocale,
  updateLocaleSchema,
} from "./locale";

describe("locale contracts", () => {
  test.each([
    ["es", "es-EC"],
    ["en", "en-US"],
  ] as const)("maps stored locale %s to app locale %s", (stored, app) => {
    expect(toAppLocale(stored)).toBe(app);
    expect(storedLocaleSchema.parse(stored)).toBe(stored);
    expect(appLocaleSchema.parse(app)).toBe(app);
  });

  test("rejects locale values outside the persisted enum", () => {
    expect(updateLocaleSchema.safeParse({ locale: "fr" }).success).toBe(false);
    expect(updateLocaleSchema.safeParse({ locale: "es-EC" }).success).toBe(false);
  });
});
