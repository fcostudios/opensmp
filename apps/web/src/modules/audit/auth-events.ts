import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { auditLog } from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import type { IdentityLinkErrorCode } from "../identity-access/repository";

export const AUTHENTICATION_SYSTEM_ENTITY_ID =
  "00000000-0000-0000-0000-000000000004";

type AuditDatabase = Pick<
  NodePgDatabase<typeof schema>,
  "insert"
>;

export async function insertAuthAudit(
  database: AuditDatabase,
  {
    actorUserId,
    action,
    errorCode,
    occurredAt,
    provider,
  }: {
    actorUserId: string | null;
    action: "authentication.oidc.failed" | "authentication.oidc.succeeded";
    errorCode: IdentityLinkErrorCode | "none";
    occurredAt: Date;
    provider: "keycloak";
  },
): Promise<void> {
  await database.insert(auditLog).values({
    actorUserId,
    action,
    entityType: "Authentication",
    entityId: AUTHENTICATION_SYSTEM_ENTITY_ID,
    before: null,
    after: { provider, errorCode },
    occurredAt,
  });
}
