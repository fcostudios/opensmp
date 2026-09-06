import { describe, expect, it } from "vitest";

import config from "./vitest.config";

describe("notifications Vitest project", () => {
  it("keeps the exact independent Node test contract", () => {
    expect(config.test?.environment).toBe("node");
    expect(config.test?.passWithNoTests).toBe(true);
    expect(config.test?.include).toEqual(["src/**/*.{test,spec}.ts"]);
  });
});
