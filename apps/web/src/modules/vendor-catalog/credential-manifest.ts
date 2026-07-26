import { readFile } from "node:fs/promises";

import { z } from "zod";

import { readKekFile } from "./credential-crypto";
import type { CredentialSeed } from "./seeding-transaction";

const environmentName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const manifestSchema = z.object({
  version: z.literal(1),
  organizations: z.array(z.object({
    vendor_org_ref: z.string().trim().min(1),
    admin_env: environmentName,
    analytics_env: environmentName,
  }).strict()),
}).strict();

export interface LoadCredentialManifestInput {
  readonly manifestPath: string;
  readonly kekPath: string;
  readonly allowedKekRoot?: string;
  readonly expectedVendorOrgRefs: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
}

export async function loadCredentialManifest({
  manifestPath,
  kekPath,
  allowedKekRoot,
  expectedVendorOrgRefs,
  environment,
}: LoadCredentialManifestInput): Promise<{
  readonly credentials: readonly CredentialSeed[];
  readonly kek: Uint8Array;
}> {
  let document: unknown;
  try {
    document = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read credential manifest: ${manifestPath}`, {
      cause: error,
    });
  }
  const manifest = manifestSchema.parse(document);
  const expected = [...new Set(expectedVendorOrgRefs)].sort();
  const actual = manifest.organizations
    .map((organization) => organization.vendor_org_ref)
    .sort();
  if (
    actual.length !== new Set(actual).size ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      "Credential manifest organizations must exactly match the capacity inventory",
    );
  }

  const credentials: CredentialSeed[] = [];
  const usedEnvironmentNames = new Set<string>();
  for (const organization of manifest.organizations) {
    if (organization.admin_env === organization.analytics_env) {
      throw new Error(
        `Credential manifest ${organization.vendor_org_ref} must use distinct env vars`,
      );
    }
    for (const name of [organization.admin_env, organization.analytics_env]) {
      if (usedEnvironmentNames.has(name)) {
        throw new Error(`Credential env var ${name} is reused across organizations`);
      }
      usedEnvironmentNames.add(name);
    }
    const admin = environment[organization.admin_env]?.trim();
    const analytics = environment[organization.analytics_env]?.trim();
    if (!admin) {
      throw new Error(`Credential env ${organization.admin_env} is missing`);
    }
    if (!analytics) {
      throw new Error(`Credential env ${organization.analytics_env} is missing`);
    }
    if (admin === analytics) {
      throw new Error(
        `Credential ${organization.vendor_org_ref} requires distinct key material`,
      );
    }
    credentials.push(
      {
        vendorOrgRef: organization.vendor_org_ref,
        kind: "admin_scoped",
        plaintext: admin,
        scopes: "read:members write:members",
      },
      {
        vendorOrgRef: organization.vendor_org_ref,
        kind: "analytics",
        plaintext: analytics,
      },
    );
  }
  return {
    credentials,
    kek: await readKekFile(kekPath, { allowedRoot: allowedKekRoot }),
  };
}

export async function loadProductionCredentialManifest(
  expectedVendorOrgRefs: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const manifestPath = environment.LEDGER_CREDENTIAL_MANIFEST_FILE?.trim();
  const kekPath = environment.LEDGER_CREDENTIAL_KEK_FILE?.trim();
  if (!manifestPath) {
    throw new Error("LEDGER_CREDENTIAL_MANIFEST_FILE is required");
  }
  if (!kekPath) {
    throw new Error("LEDGER_CREDENTIAL_KEK_FILE is required");
  }
  return loadCredentialManifest({
    manifestPath,
    kekPath,
    expectedVendorOrgRefs,
    environment,
  });
}
