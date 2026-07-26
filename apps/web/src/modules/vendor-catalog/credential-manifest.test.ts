import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCredentialManifest } from "./credential-manifest";

const directories: string[] = [];

async function fixture(manifest: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "ledger-manifest-"));
  directories.push(directory);
  const manifestPath = join(directory, "manifest.json");
  const kekPath = join(directory, "kek");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await writeFile(
    kekPath,
    `${Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index)).toString("base64")}\n`,
    "utf8",
  );
  await chmod(kekPath, 0o400);
  return { manifestPath, kekPath, allowedKekRoot: directory };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true })));
});

describe("server-side credential manifest", () => {
  it("resolves complete, distinct Admin and Analytics key families without returning env names", async () => {
    const paths = await fixture({
      version: 1,
      organizations: [{
        vendor_org_ref: "org-1",
        admin_env: "ORG_1_ADMIN_KEY",
        analytics_env: "ORG_1_ANALYTICS_KEY",
      }],
    });
    const loaded = await loadCredentialManifest({
      ...paths,
      expectedVendorOrgRefs: ["org-1"],
      environment: {
        ORG_1_ADMIN_KEY: "admin-synthetic-value",
        ORG_1_ANALYTICS_KEY: "analytics-synthetic-value",
      },
    });
    expect(loaded.credentials).toEqual([
      {
        vendorOrgRef: "org-1",
        kind: "admin_scoped",
        plaintext: "admin-synthetic-value",
        scopes: "read:members write:members",
      },
      {
        vendorOrgRef: "org-1",
        kind: "analytics",
        plaintext: "analytics-synthetic-value",
      },
    ]);
    expect(loaded.kek).toHaveLength(32);
    expect(JSON.stringify(loaded)).not.toContain("ORG_1_");
  });

  it.each([
    {
      name: "missing org",
      organizations: [],
      environment: {},
      error: /manifest organizations/i,
    },
    {
      name: "same env family",
      organizations: [{
        vendor_org_ref: "org-1",
        admin_env: "SHARED_KEY",
        analytics_env: "SHARED_KEY",
      }],
      environment: { SHARED_KEY: "value" },
      error: /distinct env vars/i,
    },
    {
      name: "missing value",
      organizations: [{
        vendor_org_ref: "org-1",
        admin_env: "ADMIN_KEY",
        analytics_env: "ANALYTICS_KEY",
      }],
      environment: { ADMIN_KEY: "admin" },
      error: /ANALYTICS_KEY.*missing/i,
    },
    {
      name: "same key material",
      organizations: [{
        vendor_org_ref: "org-1",
        admin_env: "ADMIN_KEY",
        analytics_env: "ANALYTICS_KEY",
      }],
      environment: { ADMIN_KEY: "same", ANALYTICS_KEY: "same" },
      error: /distinct key material/i,
    },
  ])("rejects $name", async ({ organizations, environment, error }) => {
    const paths = await fixture({ version: 1, organizations });
    await expect(loadCredentialManifest({
      ...paths,
      expectedVendorOrgRefs: ["org-1"],
      environment,
    })).rejects.toThrow(error);
  });
});
