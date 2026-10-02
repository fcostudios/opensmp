import { sql, type SQL } from "drizzle-orm";

/** Current delivered invitation identity; callers supply their verified company scope.
 * Select the latest attempt BEFORE checking status, so a superseded sent invite
 * cannot remain actionable while its replacement is pending or withdrawn.
 */
export function pendingInvitationRows(at: Date, companyScope: SQL): SQL {
  return sql`SELECT request.id::text AS "requestId", request.request_no AS "requestNo",
                   request.company_id::text AS "companyId",
                   request.vendor_account_id::text AS "vendorAccountId",
                   current_invite.id::text AS "actionId",
                   current_invite.vendor_ref AS "vendorRef",
                   current_invite.sent_at AS "invitedAt",
                   EXTRACT(EPOCH FROM (${at}::timestamptz-current_invite.sent_at))/3600::double precision AS "ageHours"
            FROM license_request request
            JOIN LATERAL (
              SELECT action.* FROM provisioning_action action
              WHERE action.request_id=request.id
                AND action.vendor_account_id=request.vendor_account_id
                AND action.kind='invite'
              ORDER BY action.created_at DESC,action.id DESC LIMIT 1
            ) current_invite ON true
            WHERE ${companyScope}
              AND request.state='invited'
              AND request.license_assignment_id IS NULL
              AND current_invite.mode='automated'
              AND current_invite.status='sent'
              AND current_invite.vendor_ref IS NOT NULL
              AND current_invite.sent_at IS NOT NULL
              AND current_invite.resolved_at IS NULL`;
}

export type PendingInvitationRow = {
  readonly requestId: string;
  readonly requestNo: string;
  readonly companyId: string;
  readonly vendorAccountId: string;
  readonly actionId: string;
  readonly vendorRef: string;
  readonly invitedAt: Date | string;
  readonly ageHours: number;
};
