import { describe, expect, it } from "vitest";

import * as credentialCrypto from "./credential-crypto";

describe("web credential cryptography adapter", () => {
  it("re-exports only the three shared credential operations", () => {
    expect(Object.keys(credentialCrypto).sort()).toEqual([
      "decryptCredential",
      "encryptCredential",
      "readKekFile",
    ]);
    for (const operation of Object.values(credentialCrypto)) {
      expect(operation).toBeTypeOf("function");
    }
  });
});
