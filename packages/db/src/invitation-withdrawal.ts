import { randomUUID } from "node:crypto";
import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { VendorConnector } from "@smp/connectors/contracts";
import { isInvitationDeletionReceipt } from "@smp/connectors/contracts";
import { createConnectorCallObservationSession, type ConnectorOperation, type ConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
import { decryptCredential, readKekFile } from "./credential-crypto.js";
import { applyRequestTransitionInTransaction } from "./request-transition.js";

export type InvitationWithdrawalCommand = Readonly<{
  companyId: string; requestId: string; actionId: string; commandId: string;
  actorUserId: string | null; note: string;
}>;
export type InvitationWithdrawalOutcome =
  | { readonly ok: true; readonly requestId: string; readonly actionId: string }
  | { readonly ok: false; readonly error: "invalid" | "forbidden" | "conflict" | "unsupported" | "provider_error" | "ambiguous" };
type Context = { companyId: string; requestId: string; actionId: string; vendorAccountId: string; vendorRef: string; withdrawalActionId: string };
type Intent = { id: string; vendor_ref: string; status: string; raw_request: InvitationWithdrawalCommand; raw_response: unknown };
function uuid(value:string):boolean {return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
function valid(command: InvitationWithdrawalCommand): boolean {
  return [command.companyId,command.requestId,command.actionId,command.commandId].every(value=>typeof value === "string" && uuid(value))
    && (command.actorUserId === null || (typeof command.actorUserId === "string" && uuid(command.actorUserId)))
    && typeof command.note === "string" && command.note.trim().length > 0 && command.note.length <= 2000;
}
async function current(client: pg.PoolClient, command: InvitationWithdrawalCommand): Promise<Omit<Context,"withdrawalActionId"> | null> {
  const result = await client.query<Omit<Context,"withdrawalActionId">>(`
    SELECT request.company_id::text AS "companyId",request.id::text AS "requestId",
      action.id::text AS "actionId",action.vendor_account_id::text AS "vendorAccountId",action.vendor_ref AS "vendorRef"
    FROM license_request request JOIN provisioning_action action ON action.request_id=request.id
      AND action.vendor_account_id=request.vendor_account_id
    WHERE request.id=$1::uuid AND request.company_id=$2::uuid AND action.id=$3::uuid
      AND request.state='invited' AND request.license_assignment_id IS NULL
      AND action.kind='invite' AND action.mode='automated' AND action.status='sent'
      AND action.vendor_ref IS NOT NULL AND action.vendor_ref<>'' AND action.sent_at IS NOT NULL AND action.resolved_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM license_assignment assignment WHERE assignment.company_id=request.company_id AND assignment.source_request_id=request.id)
      AND action.id=(SELECT latest.id FROM provisioning_action latest WHERE latest.request_id=request.id
        AND latest.vendor_account_id=request.vendor_account_id AND latest.kind='invite' ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
    FOR UPDATE OF request,action`,[command.requestId,command.companyId,command.actionId]);
  return result.rows[0] ?? null;
}

/** Session lock matches membership polling; row locks exist only inside short transactions. */
export function createInvitationWithdrawalService(dependencies: {
  readonly pool: pg.Pool;
  readonly now: () => Date;
  readonly assertLegalTransition: (from: "invited", to: "deprovisioned") => void;
  readonly connectorFor: (context: Context, database: pg.PoolClient) => Promise<VendorConnector | null>;
  readonly beforeNewIntent?: (context: Context, database: pg.PoolClient) => Promise<boolean>;
  readonly beforeCompletionCommit?: (context: Context, canonicalCommand: InvitationWithdrawalCommand, occurredAt: Date, database: pg.PoolClient) => Promise<void>;
}) {
  return { async withdraw(command: InvitationWithdrawalCommand): Promise<InvitationWithdrawalOutcome> {
    if (!valid(command)) return {ok:false,error:"invalid"};
    // PostgreSQL UUIDs and membership polling use this same canonical identity.
    command={...command,companyId:command.companyId.toLowerCase(),requestId:command.requestId.toLowerCase(),actionId:command.actionId.toLowerCase(),commandId:command.commandId.toLowerCase(),actorUserId:command.actorUserId === null ? null : command.actorUserId.toLowerCase(),note:command.note.trim()};
    const client=await dependencies.pool.connect();
    let locked=false,transaction=false;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[command.actionId]);locked=true;
      await client.query("BEGIN");transaction=true;
      const existing=await client.query<Intent>(`SELECT action.id::text,action.vendor_ref,action.status,action.raw_request,action.raw_response
        FROM provisioning_action action JOIN license_request request ON request.id=action.request_id AND request.vendor_account_id=action.vendor_account_id
        WHERE request.id=$1::uuid AND request.company_id=$2::uuid AND action.kind='withdraw_invite'
          AND action.raw_request->>'actionId'=$3 ORDER BY action.created_at,action.id FOR UPDATE OF action`,[command.requestId,command.companyId,command.actionId]);
      const intent=existing.rows[0];
      if (intent && (intent.raw_request.requestId !== command.requestId || intent.raw_request.commandId !== command.commandId || intent.raw_request.actorUserId !== command.actorUserId || intent.raw_request.note !== command.note || intent.raw_request.companyId !== command.companyId)) {
        await client.query("ROLLBACK");transaction=false;return {ok:false,error:"conflict"};
      }
      if (intent?.status === "withdrawn") {
        await client.query("COMMIT");transaction=false;return {ok:true,requestId:command.requestId,actionId:intent.id};
      }
      const eligible=await current(client,command);
      if (!eligible || (intent && intent.vendor_ref !== eligible.vendorRef)) {
        await client.query("ROLLBACK");transaction=false;return {ok:false,error:"conflict"};
      }
      const context={...eligible,withdrawalActionId:intent?.id ?? randomUUID()};
      if (!intent) {
        if (dependencies.beforeNewIntent && !await dependencies.beforeNewIntent(context,client)) {
          await client.query("ROLLBACK");
          // @equivalent: After successful ROLLBACK, a true flag adds an idle rollback
          // with identical healthy-DB application effects and lock release. SQL/
          // notice traffic and intervening transport failure traces differ.
          transaction=false;return {ok:false,error:"conflict"};
        }
        const actor=command.actorUserId === null ? null : (await client.query<{label:string}>(`SELECT COALESCE(person.full_name,account.email) AS label FROM user_account account LEFT JOIN person ON person.id=account.person_id WHERE account.id=$1::uuid`,[command.actorUserId])).rows[0]?.label;
        if(command.actorUserId !== null && (!actor || actor.length>320)) {
          await client.query("ROLLBACK");transaction=false;return {ok:false,error:"conflict"};
        }
        await client.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,raw_request,created_at)
          VALUES($1,$2,$3,'withdraw_invite','automated','pending',$4,$5::jsonb,$6)`,[context.withdrawalActionId,command.requestId,context.vendorAccountId,context.vendorRef,JSON.stringify({...command,actorLabel:actor}),dependencies.now()]);
      }
      await client.query("COMMIT");transaction=false;
      if (intent && !isInvitationDeletionReceipt(intent.raw_response,context.vendorRef)) return {ok:false,error:"ambiguous"};
      if (!intent) {
        const connector=await dependencies.connectorFor(context,client);
        if (!connector?.withdrawInvitation) return {ok:false,error:"unsupported"};
        const result=await connector.withdrawInvitation({requestId:command.requestId,vendorAccountId:context.vendorAccountId,vendorRef:context.vendorRef});
        if (!result.ok || result.vendorRef !== context.vendorRef || !isInvitationDeletionReceipt(result.receipt,context.vendorRef)) return {ok:false,error:"provider_error"};
        // HTTP observations alone cannot prove body identity. Commit validated receipt separately
        // so a failed finalization can recover without repeating the destructive provider call.
        const saved=await client.query(`UPDATE provisioning_action action SET raw_response=$1::jsonb
          FROM license_request request WHERE action.id=$2::uuid AND request.id=action.request_id
            AND request.company_id=$3::uuid AND action.request_id=$4::uuid AND action.vendor_account_id=$5::uuid
            AND action.kind='withdraw_invite' AND action.status='pending' AND action.vendor_ref=$6
            AND action.raw_request->>'commandId'=$7 RETURNING action.id`,[JSON.stringify(result.receipt),context.withdrawalActionId,command.companyId,command.requestId,context.vendorAccountId,context.vendorRef,command.commandId]);
        if(saved.rowCount !== 1) return {ok:false,error:"conflict"};
      }
      await client.query("BEGIN");transaction=true;
      const revalidated=await current(client,command);
      const finalIntent=await client.query<Intent>(`SELECT action.id::text,action.vendor_ref,action.status,action.raw_request,action.raw_response
        FROM provisioning_action action JOIN license_request request ON request.id=action.request_id AND request.vendor_account_id=action.vendor_account_id
        WHERE action.id=$1::uuid AND request.id=$2::uuid AND request.company_id=$3::uuid
          AND action.vendor_account_id=$4::uuid AND action.kind='withdraw_invite' FOR UPDATE OF action`,[context.withdrawalActionId,command.requestId,command.companyId,context.vendorAccountId]);
      const final=finalIntent.rows[0];
      if(!revalidated || revalidated.vendorAccountId !== context.vendorAccountId || revalidated.vendorRef !== context.vendorRef || !final || final.status !== "pending" || final.vendor_ref !== context.vendorRef || final.raw_request.requestId !== command.requestId || final.raw_request.commandId !== command.commandId || final.raw_request.actionId !== command.actionId || final.raw_request.companyId !== command.companyId || final.raw_request.actorUserId !== command.actorUserId || final.raw_request.note !== command.note || !isInvitationDeletionReceipt(final.raw_response,context.vendorRef)) {
        await client.query("ROLLBACK");transaction=false;return {ok:false,error:"conflict"};
      }
      const occurredAt=dependencies.now();
      dependencies.assertLegalTransition("invited","deprovisioned");
      await applyRequestTransitionInTransaction(drizzle(client),{requestId:command.requestId,from:"invited",to:"deprovisioned",actorUserId:command.actorUserId,note:command.note,occurredAt},{expectedCompanyId:command.companyId});
      const updated=await client.query(`UPDATE provisioning_action action SET status='withdrawn',resolved_at=$3 FROM license_request request WHERE action.id IN ($1::uuid,$2::uuid) AND request.id=action.request_id AND request.company_id=$4::uuid AND request.id=$5::uuid AND action.vendor_account_id=$6::uuid`,[command.actionId,context.withdrawalActionId,occurredAt,command.companyId,command.requestId,context.vendorAccountId]);
      if(updated.rowCount !== 2) throw new Error("WITHDRAWAL_ACTION_CONFLICT");
      await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,company_id,note,before,after,occurred_at)
        VALUES($1,'invitation.withdrawn','ProvisioningAction',$2,$3,$4,NULL,$5::jsonb,$6)`,[command.actorUserId,context.withdrawalActionId,command.companyId,command.note,JSON.stringify({originalActionId:command.actionId,vendorRef:context.vendorRef}),occurredAt]);
      await dependencies.beforeCompletionCommit?.(context,command,occurredAt,client);
      await client.query("COMMIT");transaction=false;
      return {ok:true,requestId:command.requestId,actionId:context.withdrawalActionId};
    } finally {
      try { if(transaction) await client.query("ROLLBACK"); }
      finally {
        try { if(locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[command.actionId]); }
        finally { client.release(); }
      }
    }
  } };
}

export type InvitationWithdrawalConnectorFactory = (dependencies: {
  credentialsFor: (account:string) => Promise<readonly {vendorAccountId:string;kind:"admin_scoped"|"analytics";secret:string;status:"active"|"retired";health:"ok"|"auth_failed"|"unverified"}[]>;
  observationSessionFor: (operation:{operation:ConnectorOperation;requestId:string|null;vendorAccountId:string}) => Promise<ConnectorCallObservationSession>;
  requestDependencies: {clock:{now:()=>number};sleep:(milliseconds:number)=>Promise<void>;limiter:{acquire:(account:string,budgets:readonly ("user_management"|"analytics"|"invite_create")[])=>Promise<void>};transport:(request:Request)=>Promise<Response>};
}) => VendorConnector;
export type InvitationWithdrawalLimiterFactory = (dependencies:{clock:{now:()=>number};sleep:(milliseconds:number)=>Promise<void>}) => Parameters<InvitationWithdrawalConnectorFactory>[0]["requestDependencies"]["limiter"];

/** Production credentials and observation composition; callers supply the approved connector runtime. */
export function createProductionInvitationWithdrawalConnector(input: {
  readonly database: Pick<pg.PoolClient,"query">; readonly now: () => Date;
  readonly createConnector: InvitationWithdrawalConnectorFactory;
  readonly createLimiter: InvitationWithdrawalLimiterFactory;
  readonly parseCredentialEnvelope: (value: string) => Parameters<typeof decryptCredential>[0];
  readonly kekFile?: string; readonly allowedKekRoot?: string;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly transport?: (request: Request) => Promise<Response>;
}) {
  const clock={now:()=>input.now().getTime()},sleep=input.sleep??(async(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds)));
  const limiter=input.createLimiter({clock,sleep});
  return async (context: Context): Promise<VendorConnector | null> => {
    const provider=await input.database.query(`SELECT vendor.provisioning_protocol FROM vendor_account account JOIN vendor ON vendor.id=account.vendor_id
      WHERE account.id=$1 AND account.mode='automated' AND account.status='active' AND vendor.status='active' AND vendor.can_deprovision`,[context.vendorAccountId]);
    if(provider.rows[0]?.provisioning_protocol !== "rest") return null;
    const kekFile=input.kekFile??process.env.LEDGER_CREDENTIAL_KEK_FILE;
    if(kekFile===undefined)throw new Error("INVITATION_WITHDRAWAL_KEK_NOT_CONFIGURED");
    const kek=await readKekFile(kekFile,{allowedRoot:input.allowedKekRoot});
    return input.createConnector({credentialsFor:async(account)=>{
      if(account !== context.vendorAccountId) throw new Error("WITHDRAWAL_ACCOUNT_MISMATCH");
      const result=await input.database.query<{encrypted_secret:string;kind:"admin_scoped"|"analytics";status:"active"|"retired";health:"ok"|"auth_failed"|"unverified"}>(`SELECT encrypted_secret,kind,status,health FROM integration_credential WHERE vendor_account_id=$1 AND status='active' ORDER BY kind`,[account]);
      return Promise.all(result.rows.map(async(row)=>({...row,vendorAccountId:account,secret:await decryptCredential(input.parseCredentialEnvelope(row.encrypted_secret),kek)})));
    },observationSessionFor:async(operation)=>createConnectorCallObservationSession({vendorAccountId:context.vendorAccountId,provisioningActionId:context.withdrawalActionId,operation:operation.operation,clock:input.now,randomId:randomUUID,append:async(event)=>{
      await input.database.query(`INSERT INTO connector_call_observation(vendor_account_id,provisioning_action_id,correlation_id,operation,attempt,phase,classification,summary,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[event.vendorAccountId,event.provisioningActionId,event.correlationId,event.operation,event.attempt,event.phase,event.classification,event.summary,event.occurredAt]);
    }}),requestDependencies:{clock,sleep,limiter,transport:input.transport??(async(request)=>fetch(request))}});
  };
}

export function createAuthorizedInvitationWithdrawal(dependencies: {
  readonly pool: pg.Pool;
  readonly loadAuthorization: () => Promise<{readonly globalRole:string|null;readonly userAccountId:string;readonly companyIds:readonly string[]} | null>;
  readonly service: ReturnType<typeof createInvitationWithdrawalService>;
  readonly recordOutcome: (actorUserId:string|null, requestId:string|null, outcome:InvitationWithdrawalOutcome) => Promise<void>;
}) {
  return async (form: FormData): Promise<InvitationWithdrawalOutcome> => {
    const authorization=await dependencies.loadAuthorization();
    const submittedRequestId=form.get("requestId"),actionId=form.get("actionId"),commandId=form.get("commandId"),note=form.get("note");
    const requestId=typeof submittedRequestId === "string" && uuid(submittedRequestId) ? submittedRequestId.toLowerCase() : null;
    const actorUserId=authorization && uuid(authorization.userAccountId) ? authorization.userAccountId.toLowerCase() : authorization?.userAccountId??null;
    let outcome:InvitationWithdrawalOutcome;
    if(authorization?.globalRole !== "group_admin") outcome={ok:false,error:"forbidden"};
    else if(requestId === null || typeof actionId !== "string" || !uuid(actionId) || typeof commandId !== "string" || !uuid(commandId) || typeof note !== "string" || !note.trim() || note.length>2000) outcome={ok:false,error:"invalid"};
    else {
      const scoped=await dependencies.pool.query<{companyId:string}>(`SELECT company_id::text AS "companyId" FROM license_request WHERE id=$1::uuid AND company_id=ANY($2::uuid[])`,[requestId,authorization.companyIds]);
      const companyId=scoped.rows[0]?.companyId;
      try {
        outcome=companyId ? await dependencies.service.withdraw({companyId,requestId,actionId:actionId.toLowerCase(),commandId:commandId.toLowerCase(),note,actorUserId}) : {ok:false,error:"forbidden"};
      } catch { outcome={ok:false,error:"ambiguous"}; }
    }
    await dependencies.recordOutcome(actorUserId,requestId,outcome);
    return outcome;
  };
}
