import { sql } from "drizzle-orm";
import { z } from "zod";

// eslint-disable-next-line no-restricted-imports -- This trusted transaction records the canonical system actor.
import { SYSTEM_USER_ID } from "@smp/db";

import type { LedgerTransaction } from "../request-workflow/transition-core";

const noSeatObservationSchema = z.object({
  requestId: z.string().uuid(),
  source: z.enum(["pool_empty", "provider_400"]),
}).strict();

export async function observeNoSeatInTransaction(
  transaction: LedgerTransaction,
  input: unknown,
  occurredAt: Date,
): Promise<{ readonly requestId: string; readonly status: "blocked_no_seat" }> {
  const parsed = noSeatObservationSchema.safeParse(input);
  if (!parsed.success) throw new Error("CAPACITY_INPUT_INVALID");
  const locked = await transaction.execute<{
    readonly companyId: string;
    readonly state: "approved" | "blocked_no_seat";
  }>(
    sql`SELECT company_id::text AS "companyId", state::text AS state
        FROM license_request
        WHERE id = ${parsed.data.requestId}::uuid
          AND state IN ('approved','blocked_no_seat')
        FOR UPDATE`,
  );
  const request = locked.rows[0];
  if (!request) throw new Error("CAPACITY_REQUEST_NOT_FOUND");
  if (request.state === "blocked_no_seat") {
    return { requestId: parsed.data.requestId, status: "blocked_no_seat" };
  }
  await transaction.execute(
    sql`UPDATE license_request
        SET state='blocked_no_seat',updated_at=${occurredAt}
        WHERE id=${parsed.data.requestId}::uuid
          AND company_id=${request.companyId}::uuid AND state='approved'`,
  );
  await transaction.execute(
    sql`INSERT INTO request_transition
          (request_id,from_state,to_state,actor_user_id,note,occurred_at)
        VALUES (${parsed.data.requestId}::uuid,'approved','blocked_no_seat',
                ${SYSTEM_USER_ID}::uuid,${parsed.data.source},${occurredAt})`,
  );
  await transaction.execute(
    sql`INSERT INTO audit_log
          (actor_user_id,action,entity_type,entity_id,company_id,note,before,after,occurred_at)
        VALUES (${SYSTEM_USER_ID}::uuid,'request.blocked_no_seat','LicenseRequest',
                ${parsed.data.requestId}::uuid,${request.companyId}::uuid,
                ${parsed.data.source},'{"state":"approved"}'::jsonb,
                '{"state":"blocked_no_seat"}'::jsonb,${occurredAt})`,
  );
  const event = await transaction.execute<{ readonly id: string }>(
    sql`INSERT INTO alert_event
          (alert_rule_id,fired_at,subject_ref,notified,dedupe_key)
        SELECT rule.id,${occurredAt},
               ${JSON.stringify({ requestId: parsed.data.requestId })}::jsonb,
               '{"status":"pending"}'::jsonb,
               rule.id::text || ':blocked:' || ${parsed.data.requestId}
        FROM alert_rule rule
        WHERE rule.type='blocked_no_seat' AND rule.enabled
          AND (rule.scope_kind='global' OR
               (rule.scope_kind='company' AND rule.company_id=${request.companyId}::uuid))
        ORDER BY CASE rule.scope_kind WHEN 'company' THEN 0 ELSE 1 END
        LIMIT 1
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        RETURNING id::text AS id`,
  );
  const eventId = event.rows[0]?.id;
  if (eventId) {
    const recipients = await transaction.execute<{
      readonly email: string;
      readonly id: string;
      readonly locale: "en" | "es";
    }>(
      sql`SELECT DISTINCT ON (recipient.id)
                 recipient.id::text AS id,recipient.email,
                 recipient.ui_language::text AS locale
          FROM license_request request
          JOIN user_account recipient ON recipient.status='active'
           AND (recipient.id=request.requested_by OR recipient.global_role='group_admin')
          WHERE request.id=${parsed.data.requestId}::uuid
            AND request.company_id=${request.companyId}::uuid
          ORDER BY recipient.id`,
    );
    for (const recipient of recipients.rows) {
      await transaction.execute(
        sql`SELECT append_alert_recipient_pending(
              ${eventId}::uuid,${`user:${recipient.id}`},${recipient.id}::uuid,
              ${recipient.email},${recipient.locale}::user_account_ui_language_enum,
              ${occurredAt})`,
      );
    }
  }
  return { requestId: parsed.data.requestId, status: "blocked_no_seat" };
}
