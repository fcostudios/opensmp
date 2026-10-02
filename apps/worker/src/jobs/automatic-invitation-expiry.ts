import pg from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { inviteUnacceptedThresholdSchema } from "@smp/contracts/alerts";
import { isInvitationDeletionReceipt } from "@smp/connectors/contracts";
import { createInvitationWithdrawalService, createProductionInvitationWithdrawalConnector, type InvitationWithdrawalCommand } from "@smp/db/invitation-withdrawal";
import { enqueueLifecycleInvitationExpired } from "@smp/db/lifecycle-notifications";
import { pendingInvitationRows, type PendingInvitationRow } from "@smp/db/pending-invitations";
import { parseCredentialEnvelope } from "@smp/domain";
import { assertLegalTransition } from "@smp/domain/request-workflow";
import { automaticInvitationExpiryNote } from "@smp/notifications/catalog";
import { createProvisioningConnector, createProvisioningRateLimiter } from "../connector-composition.js";

type Candidate = PendingInvitationRow & { locale: unknown };
type Rule = { threshold: unknown };
export type AutomaticInvitationExpiryJobOptions = Readonly<{
  connectionString: string;
  allowedKekRoot?: string;
  kekFile?: string;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  transport: (request: Request) => Promise<Response>;
}>;
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function createAutomaticInvitationExpiryJob(options: AutomaticInvitationExpiryJobOptions) {
  const pool = new pg.Pool({ connectionString: options.connectionString });

  async function candidates(database: pg.Pool | pg.PoolClient, at: Date, vendorAccountId?: string, identity?: { companyId: string; requestId: string; actionId: string }): Promise<Candidate[]> {
    const scope = identity ? sql`request.company_id=${identity.companyId}::uuid AND request.id=${identity.requestId}::uuid`
      : sql`request.company_id IN (SELECT id FROM company WHERE status='active')`;
    const rows = await drizzle(database).execute(sql`WITH pending AS (${pendingInvitationRows(at, scope)})
      SELECT pending.*,COALESCE(requester.ui_language::text,company.statement_language::text) AS locale
      FROM pending
      JOIN company ON company.id=pending."companyId"::uuid AND company.status='active'
      JOIN license_request request ON request.id=pending."requestId"::uuid AND request.company_id=pending."companyId"::uuid
      JOIN person ON person.id=request.person_id AND person.company_id=request.company_id
      JOIN vendor_account account ON account.id=pending."vendorAccountId"::uuid AND account.status='active' AND account.mode='automated'
      JOIN user_account requester ON requester.id=request.requested_by AND requester.status='active'
        AND requester.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      WHERE (${vendorAccountId ?? null}::uuid IS NULL OR pending."vendorAccountId"::uuid=${vendorAccountId ?? null}::uuid)
        AND (${identity?.actionId ?? null}::uuid IS NULL OR pending."actionId"::uuid=${identity?.actionId ?? null}::uuid)
        AND pending."vendorRef"<>''
        AND NOT EXISTS (SELECT 1 FROM license_assignment assignment WHERE assignment.company_id=request.company_id AND assignment.source_request_id=request.id)
      ORDER BY pending."actionId"`);
    return rows.rows as Candidate[];
  }

  async function eligible(database: pg.Pool | pg.PoolClient, candidate: Candidate, lockRules: boolean): Promise<boolean> {
    // A scan is not authorization. Under the original invitation lock, hold each
    // applicable rule through preparation COMMIT so a rule change cannot slip in.
    const rules = await database.query<Rule>(`SELECT id,threshold FROM alert_rule
      WHERE type='invite_unaccepted' AND enabled
        AND ((scope_kind='global' AND company_id IS NULL AND vendor_account_id IS NULL)
          OR (scope_kind='company' AND company_id=$1::uuid AND vendor_account_id IS NULL)
          OR (scope_kind='vendor_account' AND vendor_account_id=$2::uuid AND company_id IS NULL))
      ORDER BY id ${lockRules ? "FOR SHARE" : ""}`, [candidate.companyId, candidate.vendorAccountId]);
    return rules.rows.some(rule => {
      const parsed = inviteUnacceptedThresholdSchema.safeParse(rule.threshold);
      return parsed.success && parsed.data.auto_withdraw_after_hours !== null
        && Number.isFinite(candidate.ageHours) && candidate.ageHours > parsed.data.auto_withdraw_after_hours;
    });
  }

  async function recoverable(vendorAccountId?: string): Promise<InvitationWithdrawalCommand[]> {
    const rows = await pool.query<{companyId: string; requestId: string; actionId: string; vendorRef: string; rawRequest: unknown; rawResponse: unknown}>(`
      SELECT request.company_id::text AS "companyId",request.id::text AS "requestId",original.id::text AS "actionId",
        original.vendor_ref AS "vendorRef",withdrawal.raw_request AS "rawRequest",withdrawal.raw_response AS "rawResponse"
      FROM provisioning_action withdrawal
      JOIN license_request request ON request.id=withdrawal.request_id AND request.vendor_account_id=withdrawal.vendor_account_id
      JOIN provisioning_action original ON original.request_id=request.id AND original.vendor_account_id=request.vendor_account_id
        AND original.kind='invite' AND original.id::text=withdrawal.raw_request->>'actionId'
      WHERE request.company_id::text=(withdrawal.raw_request->>'companyId')
        AND withdrawal.kind='withdraw_invite' AND withdrawal.mode='automated' AND withdrawal.status='pending'
        AND withdrawal.vendor_ref=original.vendor_ref AND withdrawal.raw_response IS NOT NULL
        AND ($1::uuid IS NULL OR withdrawal.vendor_account_id=$1::uuid)
      ORDER BY withdrawal.created_at,withdrawal.id`, [vendorAccountId ?? null]);
    const commands: InvitationWithdrawalCommand[] = [];
    for (const row of rows.rows) {
      const command = row.rawRequest as InvitationWithdrawalCommand | null;
      if (command && command.companyId === row.companyId && command.requestId === row.requestId
        && command.actionId === row.actionId && command.commandId === row.actionId && command.actorUserId === null
        && typeof command.note === "string" && command.note.trim() === command.note
        && isInvitationDeletionReceipt(row.rawResponse,row.vendorRef)) commands.push(command);
    }
    return commands;
  }

  return Object.freeze({
    async close(): Promise<void> { await pool.end(); },
    async drain(input: Readonly<{ at: Date; vendorAccountId?: string }>): Promise<{ processed: number }> {
      if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) throw new Error("AUTOMATIC_INVITATION_EXPIRY_TIME_INVALID");
      if (input.vendorAccountId !== undefined && !uuid(input.vendorAccountId)) throw new Error("AUTOMATIC_INVITATION_EXPIRY_VENDOR_INVALID");
      const vendorAccountId = input.vendorAccountId?.toLowerCase();
      const at = new Date(input.at);
      const service = createInvitationWithdrawalService({
        pool, now: options.now, assertLegalTransition,
        connectorFor: async (context,database) => createProductionInvitationWithdrawalConnector({
          database, now: options.now, createConnector: createProvisioningConnector, createLimiter: createProvisioningRateLimiter,
          parseCredentialEnvelope, kekFile: options.kekFile, allowedKekRoot: options.allowedKekRoot,
          sleep: options.sleep, transport: options.transport,
        })(context),
        beforeNewIntent: async (context,database) => {
          const [current] = await candidates(database,at,vendorAccountId,context);
          return current !== undefined && await eligible(database,current,true);
        },
        beforeCompletionCommit: async (context,_command,occurredAt,database) => {
          await enqueueLifecycleInvitationExpired(drizzle(database),context.companyId,context.requestId,context.actionId,occurredAt);
        },
      });
      const commands = new Map<string,InvitationWithdrawalCommand>();
      for (const command of await recoverable(vendorAccountId)) commands.set(command.actionId,command);
      for (const candidate of await candidates(pool,at,vendorAccountId)) {
        if (!commands.has(candidate.actionId) && await eligible(pool,candidate,false)) commands.set(candidate.actionId,{
          companyId: candidate.companyId, requestId: candidate.requestId, actionId: candidate.actionId,
          commandId: candidate.actionId, actorUserId: null, note: automaticInvitationExpiryNote(candidate.locale),
        });
      }
      let processed = 0;
      for (const command of commands.values()) if ((await service.withdraw(command)).ok) processed += 1;
      return { processed };
    },
  });
}
