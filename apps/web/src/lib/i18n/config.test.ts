import { describe, expect, test } from "vitest";

import { resolveAppLocale } from "./config";

describe("resolveAppLocale", () => {
  test("prefers a valid authenticated user locale over the system default", () => {
    expect(
      resolveAppLocale({ userUiLanguage: "en", systemDefaultLanguage: "es" }),
    ).toBe("en-US");
  });

  test.each([
    ["en", "en-US"],
    ["es", "es-EC"],
    ["fr", "es-EC"],
    [null, "es-EC"],
    [{ locale: "en" }, "es-EC"],
  ] as const)(
    "uses the validated system setting %j, otherwise the es-EC safety fallback",
    (systemDefaultLanguage, expected) => {
      expect(
        resolveAppLocale({
          userUiLanguage: null,
          systemDefaultLanguage,
        }),
      ).toBe(expected);
    },
  );
});
