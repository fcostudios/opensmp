import {
  and,
  desc,
  eq,
  gte,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  hasCapability,
  type AuthorizationContext,
} from "@smp/domain/identity-access";
import { db } from "@smp/db";
import {
  auditLog,
  company,
  userAccount,
} from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import type {
  AuditFilters,
  AuditListItem,
  AuditListPage,
} from "./types";
import { AUDIT_TIME_ZONE } from "./types";

type Database = NodePgDatabase<typeof schema>;

export class AuditViewerAccessError extends Error {
  readonly status = 403;

  constructor() {
    super("Audit viewer access denied");
    this.name = "AuditViewerAccessError";
  }
}

interface AuditCursor {
  readonly id: string;
  readonly occurredAt: string;
}

function encodeCursor(item: AuditListItem): string {
  return Buffer.from(
    JSON.stringify({
      id: item.id,
      occurredAt: item.occurredAt,
    } satisfies AuditCursor),
  ).toString("base64url");
}

function decodeCursor(cursor: string): AuditCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<AuditCursor>;
    if (
      typeof value.id !== "string" ||
      typeof value.occurredAt !== "string" ||
      Number.isNaN(Date.parse(value.occurredAt))
    ) {
      throw new Error("invalid cursor");
    }
    return { id: value.id, occurredAt: value.occurredAt };
  } catch {
    throw new Error("Invalid audit cursor");
  }
}

function dateBoundary(date: string, nextDay = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid audit date filter");
  }
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new Error("Invalid audit date filter");
  }
  if (nextDay) calendarDate.setUTCDate(calendarDate.getUTCDate() + 1);

  const target = Date.UTC(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth(),
    calendarDate.getUTCDate(),
  );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: AUDIT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let result = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(result))
        .filter(({ type }) => type !== "literal")
        .map(({ type, value }) => [type, Number(value)]),
    );
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    result += target - represented;
  }
  return new Date(result);
}

function entityHref(entityType: string, entityId: string): string | null {
  const routes: Readonly<Record<string, string>> = {
    Company: "/companias",
    LicenseRequest: "/solicitudes",
    Person: "/personas",
    Statement: "/estados-de-cuenta",
    VendorAccount: "/organizaciones",
  };
  const route = routes[entityType];
  return route ? `${route}/${entityId}` : null;
}

export function createAuditQueryService(database: Database) {
  function requireAccess(authorization: AuthorizationContext): void {
    if (!hasCapability(authorization, "audit:read")) {
      throw new AuditViewerAccessError();
    }
  }

  return {
    async actions(authorization: AuthorizationContext) {
      requireAccess(authorization);
      const rows = await database
        .selectDistinct({ action: auditLog.action })
        .from(auditLog)
        .orderBy(auditLog.action);
      return rows.map(({ action }) => action);
    },

    async actors(authorization: AuthorizationContext) {
      requireAccess(authorization);
      return database
        .selectDistinct({
          id: userAccount.id,
          email: userAccount.email,
        })
        .from(userAccount)
        .innerJoin(
          auditLog,
          eq(userAccount.id, auditLog.actorUserId),
        )
        .orderBy(userAccount.email);
    },

    async entityTypes(authorization: AuthorizationContext) {
      requireAccess(authorization);
      const rows = await database
        .selectDistinct({ entityType: auditLog.entityType })
        .from(auditLog)
        .orderBy(auditLog.entityType);
      return rows.map(({ entityType }) => entityType);
    },

    async list(
      authorization: AuthorizationContext,
      filters: AuditFilters,
    ): Promise<AuditListPage> {
      requireAccess(authorization);

      const conditions: SQL[] = [];
      if (filters.entityType) {
        conditions.push(eq(auditLog.entityType, filters.entityType));
      }
      if (filters.action) {
        conditions.push(eq(auditLog.action, filters.action));
      }
      if (filters.actor === "system") {
        conditions.push(isNull(auditLog.actorUserId));
      } else if (filters.actor) {
        conditions.push(eq(auditLog.actorUserId, filters.actor));
      }
      if (filters.startDate) {
        conditions.push(
          gte(auditLog.occurredAt, dateBoundary(filters.startDate)),
        );
      }
      if (filters.endDate) {
        conditions.push(
          lt(auditLog.occurredAt, dateBoundary(filters.endDate, true)),
        );
      }
      if (filters.cursor) {
        const cursor = decodeCursor(filters.cursor);
        const occurredAt = new Date(cursor.occurredAt);
        conditions.push(
          or(
            lt(auditLog.occurredAt, occurredAt),
            and(
              eq(auditLog.occurredAt, occurredAt),
              lt(auditLog.id, cursor.id),
            ),
          )!,
        );
      }

      const rows = await database
        .select({
          id: auditLog.id,
          actorUserId: auditLog.actorUserId,
          actorEmail: userAccount.email,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          companyId: auditLog.companyId,
          companyName: company.name,
          companyCode: company.code,
          note: auditLog.note,
          before: auditLog.before,
          after: auditLog.after,
          occurredAt: auditLog.occurredAt,
        })
        .from(auditLog)
        .leftJoin(
          userAccount,
          eq(auditLog.actorUserId, userAccount.id),
        )
        .leftJoin(company, eq(auditLog.companyId, company.id))
        .where(and(...conditions))
        .orderBy(
          desc(auditLog.occurredAt),
          desc(auditLog.id),
        )
        .limit(51);

      const items = rows.slice(0, 50).map(
        (row): AuditListItem => ({
          ...row,
          entityHref: entityHref(row.entityType, row.entityId),
          occurredAt: row.occurredAt.toISOString(),
        }),
      );
      return {
        items,
        nextCursor:
          rows.length > 50 && items.length > 0
            ? encodeCursor(items[items.length - 1]!)
            : null,
      };
    },
  };
}

export const auditQueryService = createAuditQueryService(
  db as unknown as Database,
);
