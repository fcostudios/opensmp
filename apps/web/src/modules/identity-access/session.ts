import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "@smp/db";
import * as schema from "@smp/db/schema";

import type { LedgerSessionUser } from "@/lib/auth/auth-types";

import {
  createIdentityAccessRepository,
  IdentityLinkError,
  type IdentityAccessRepository,
} from "./repository";

export interface KeycloakOidcProfile {
  readonly email?: string | null;
  readonly email_verified?: boolean | null;
  readonly family_name?: string | null;
  readonly given_name?: string | null;
  readonly name?: string | null;
  readonly sub?: string | null;
}

const productionRepository = createIdentityAccessRepository(
  db as unknown as NodePgDatabase<typeof schema>,
);

export async function completeKeycloakSignIn(
  profile: KeycloakOidcProfile,
  {
    repository = productionRepository,
    now = new Date(),
  }: {
    repository?: IdentityAccessRepository;
    now?: Date;
  } = {},
): Promise<void> {
  await repository.completeOidcLogin({
    provider: "keycloak",
    subject: profile.sub ?? "",
    email: profile.email ?? "",
    emailVerified: profile.email_verified === true,
    loginAt: now,
  });
}

export async function loadLedgerSessionUser(
  {
    subject,
    name,
  }: {
    subject: string;
    name: string;
  },
  {
    repository = productionRepository,
  }: {
    repository?: IdentityAccessRepository;
  } = {},
): Promise<LedgerSessionUser> {
  const sessionUser = await repository.loadSessionUser({
    subject,
    name,
  });
  if (!sessionUser) {
    throw new IdentityLinkError("account_disabled");
  }
  return sessionUser;
}
