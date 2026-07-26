import { expect, test } from "vitest";

import { publicAppOrigin } from "./public-app-origin";

test("uses the configured public Auth.js origin and never a request host", () => {
  expect(
    publicAppOrigin({
      AUTH_URL: "https://ledger.example",
      NEXTAUTH_URL: "https://legacy.example",
      NODE_ENV: "production",
    }),
  ).toBe("https://ledger.example");
  expect(
    publicAppOrigin({
      NEXTAUTH_URL: "http://localhost:3104",
      NODE_ENV: "production",
    }),
  ).toBe("http://localhost:3104");
});

test.each([
  "ftp://ledger.example",
  "https://user:secret@ledger.example",
  "https://ledger.example/path",
  "https://ledger.example?next=attacker",
  "not-a-url",
])("rejects an unsafe configured public app origin: %s", (configured) => {
  expect(() =>
    publicAppOrigin({ AUTH_URL: configured, NODE_ENV: "production" }),
  ).toThrow("valid public application origin");
});

test("falls back to localhost only in development", () => {
  expect(publicAppOrigin({ NODE_ENV: "development" })).toBe(
    "http://localhost:3000",
  );
  expect(() => publicAppOrigin({ NODE_ENV: "production" })).toThrow(
    "valid public application origin",
  );
});
