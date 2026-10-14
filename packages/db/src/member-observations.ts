import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { validateMemberEvidence, type ConnectorMemberRecord, type NormalizedMemberRecord,
  type MemberIdentityWarning, type MemberEvidenceDescriptor, type IngestionSource } from "@smp/connectors/contracts";
import * as schema from "./schema";

type Database = Pick<PgDatabase<PgQueryResultHKT,typeof schema>,"select"|"insert"|"transaction">;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Observation = typeof schema.memberObservation.$inferSelect;
type Stream = "members"|"invitations";
export type MemberObservationPage = Readonly<{correlationId:string;terminalAttempt:number;stream:Stream;recordCount:number}>;
/** Trusted server producer receipt: US-084 proves pagination exhaustion; US-055 proves parse-to-end.
 * Never bind this receipt directly from an HTTP payload. Journal rows independently bind each supplied page. */
export type MemberObservationCompleteness = Readonly<{
  kind:"api";pages:readonly MemberObservationPage[];exhausted:readonly Stream[];providerTotals?:Partial<Record<Stream,number>>;
}> | Readonly<{kind:"csv_import"|"manual";complete:boolean;accountWide:boolean;recordCount:number}>;
export type MemberObservationInput = Readonly<{vendorAccountId:string;source:IngestionSource;observedAt:Date;
  members:readonly ConnectorMemberRecord[];evidence:MemberEvidenceDescriptor;completeness:MemberObservationCompleteness;actorUserAccountId:string|null}>;
export type MemberObservationAccepted = Readonly<{type:"member_observation_accepted";observation:Observation;
  members:readonly NormalizedMemberRecord[];warnings:readonly MemberIdentityWarning[]}>;
export type MemberObservationConsumer = (tx:Transaction,event:MemberObservationAccepted)=>Promise<void>;
export type MemberObservationResult = {status:"accepted"|"replayed";observation:Observation;members:readonly NormalizedMemberRecord[];warnings:readonly MemberIdentityWarning[]}
  | {status:"stale"|"conflict"|"incomplete"|"forbidden"};
export type MemberObservationOptions = Readonly<{now?:()=>Date;createId?:()=>string}>;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0;
const ordered=(left:string,right:string)=>left<right?-1:left>right?1:0;
function canonical(record:NormalizedMemberRecord):string {
  return JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a],[b])=>ordered(a,b))));
}

async function complete(tx:Transaction,input:MemberObservationInput):Promise<boolean> {
  const receipt=input.completeness;
  if(!receipt||receipt.kind!==input.source)return false;
  if(receipt.kind!=='api')return receipt.complete===true&&receipt.accountWide===true&&count(receipt.recordCount)&&receipt.recordCount===input.members.length;
  if(!Array.isArray(receipt.pages)||!Array.isArray(receipt.exhausted)||receipt.exhausted.length!==2
    ||!receipt.exhausted.includes('members')||!receipt.exhausted.includes('invitations'))return false;
  const seen=new Set<string>();const totals={members:0,invitations:0};const streams=new Set<Stream>();let invitations=false;
  for(const page of receipt.pages as readonly MemberObservationPage[]) {
    if(!page||typeof page!=="object")return false;
    if(!uuid(page.correlationId)||!Number.isSafeInteger(page.terminalAttempt)||page.terminalAttempt<1||!count(page.recordCount)
      ||!['members','invitations'].includes(page.stream)||seen.has(`${page.correlationId.toLowerCase()}:${page.terminalAttempt}`))return false;
    if(page.stream==='invitations')invitations=true;else if(invitations)return false;
    seen.add(`${page.correlationId.toLowerCase()}:${page.terminalAttempt}`);streams.add(page.stream);totals[page.stream]+=page.recordCount;
    const journal=await tx.select().from(schema.connectorCallObservation).where(and(
      eq(schema.connectorCallObservation.correlationId,page.correlationId),eq(schema.connectorCallObservation.attempt,page.terminalAttempt)));
    const requested=journal.find(row=>row.phase==='requested'),succeeded=journal.find(row=>row.phase==='succeeded');
    if(journal.length!==2||!requested||!succeeded||succeeded.classification!=='success')return false;
    for(const row of journal) {
      const summary=row.summary as Record<string,unknown>;
      if(row.vendorAccountId!==input.vendorAccountId||row.operation!=='sync_members'||row.provisioningActionId!==null
        ||!summary||summary.endpoint_class!==(page.stream==='members'?'members':'invitations')||summary.method!=='GET')return false;
    }
  }
  if(streams.size!==2||totals.members!==input.members.filter(record=>record.membership_status==='member').length
    ||totals.invitations!==input.members.filter(record=>record.membership_status==='invited').length)return false;
  if(receipt.providerTotals!==undefined) {
    if(!receipt.providerTotals||typeof receipt.providerTotals!=='object'||Array.isArray(receipt.providerTotals))return false;
    for(const [stream,total]of Object.entries(receipt.providerTotals))if(!['members','invitations'].includes(stream)||!count(total)||total!==totals[stream as Stream])return false;
  }
  return true;
}

/** Internal server composition only: callers supply authenticated job/admin identity, never a SQL actor setting. */
export async function acceptMemberObservation(database:Database,input:MemberObservationInput,
  consumers:readonly MemberObservationConsumer[]=[],options:MemberObservationOptions={}):Promise<MemberObservationResult> {
  if(!uuid(input.vendorAccountId)||!(input.observedAt instanceof Date)||!Number.isFinite(input.observedAt.getTime())
    ||!['api','csv_import','manual'].includes(input.source)||!Array.isArray(input.members))return {status:'incomplete'};
  input={...input,vendorAccountId:input.vendorAccountId.toLowerCase()};
  let records:ConnectorMemberRecord[];
  try {
    records=input.members.map(record=>({...record,email:typeof record.email==='string'?record.email.trim().toLowerCase():record.email,
      ...(record.membership_status==='invited'?{seat_evidence:'unlicensed' as const,seat_evidence_provenance:null}:{})}));
    validateMemberEvidence({records,evidence:input.evidence});
  } catch{return {status:'incomplete'};}
  const now=(options.now??(()=>new Date()))(),createId=options.createId??randomUUID;
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('Invalid observation acceptance clock');
  return database.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.vendorAccountId},83083))`);
    const [catalog]=await tx.select({account:schema.vendorAccount,vendor:schema.vendor}).from(schema.vendorAccount)
      .innerJoin(schema.vendor,eq(schema.vendor.id,schema.vendorAccount.vendorId)).where(eq(schema.vendorAccount.id,input.vendorAccountId))
      .for('share',{of:[schema.vendorAccount,schema.vendor]});
    if(!catalog||catalog.account.status!=='active'||catalog.vendor.status!=='active')return {status:'forbidden'};
    if(input.source==='api') {
      if(input.actorUserAccountId!==null||catalog.account.ingestionMode!=='api')return {status:'forbidden'};
    } else {
      if(!uuid(input.actorUserAccountId))return {status:'forbidden'};
      const [actor]=await tx.select().from(schema.userAccount).where(eq(schema.userAccount.id,input.actorUserAccountId)).for('share');
      if(!actor||actor.status!=='active'||actor.globalRole!=='group_admin')return {status:'forbidden'};
    }
    if(input.evidence.member_seat_evidence!==catalog.vendor.memberSeatEvidence||input.evidence.member_license_identity!==catalog.vendor.memberLicenseIdentity
      ||!await complete(tx,input))return {status:'incomplete'};
    const licenses=await tx.select().from(schema.licenseType).where(and(eq(schema.licenseType.vendorId,catalog.vendor.id),eq(schema.licenseType.status,'active'))).for('share');
    const warnings:MemberIdentityWarning[]=[];
    const emails=new Map<string,number>(),identities=new Map<string,number>();
    for(const record of records){if(record.email!==null)emails.set(record.email,(emails.get(record.email)??0)+1);
      if(record.provider_member_ref!==null)identities.set(record.provider_member_ref,(identities.get(record.provider_member_ref)??0)+1);}
    const members:NormalizedMemberRecord[]=records.map(record=>{
      const warning=(kind:MemberIdentityWarning['kind'],detail:string)=>warnings.push({kind,provider_member_ref:record.provider_member_ref,email:record.email,detail});
      if(record.email===null)warning('null_email','Missing member email');
      if((record.email!==null&&(emails.get(record.email)??0)>1)||(record.provider_member_ref!==null&&(identities.get(record.provider_member_ref)??0)>1))warning('ambiguous_identity','Member identity appears more than once');
      let seat=record.seat_evidence,licenseTypeId:string|null=null;
      if(record.membership_status==='member') {
        const capability=catalog.vendor.memberSeatEvidence;
        const proven=capability==='all_members_licensed'?seat==='licensed'&&record.seat_evidence_provenance==='capability:all_members_licensed'
          :capability==='provider_field'&&seat!=='unknown'&&/^provider_field:[^\s]+$/.test(record.seat_evidence_provenance??'');
        if(!proven){seat='unknown';warning('unknown_seat_evidence','Seat evidence is not established by the vendor capability');}
        if(seat==='licensed') {
          const matches=catalog.vendor.memberLicenseIdentity==='provider_field'
            ?licenses.filter(license=>record.provider_license_ref!==null&&license.providerRef===record.provider_license_ref)
            :licenses.filter(license=>license.id===catalog.account.defaultLicenseTypeId);
          if(matches.length===1)licenseTypeId=matches[0]!.id;else warning('unmapped_license','No unique active vendor license mapping');
        }
      }else seat='unlicensed';
      return {...record,seat_evidence:seat,license_type_id:licenseTypeId};
    });
    const contentHash=createHash('sha256').update(`[${members.map(canonical).sort(ordered).join(',')}]`).digest('hex');
    const [latest]=await tx.select().from(schema.memberObservation).where(eq(schema.memberObservation.vendorAccountId,input.vendorAccountId))
      .orderBy(desc(schema.memberObservation.observedAt)).limit(1);
    const audit=async(action:string,after:unknown)=>{await tx.insert(schema.auditLog).values({id:createId(),actorUserId:input.actorUserAccountId,
      action,entityType:'VendorAccount',entityId:input.vendorAccountId,companyId:null,after,occurredAt:now});};
    if(latest&&input.observedAt.getTime()<latest.observedAt.getTime()) {
      await audit('member_observation_stale',{vendor_account_id:input.vendorAccountId,observed_at:input.observedAt.toISOString(),latest_observation_id:latest.id});return {status:'stale'};
    }
    if(latest&&input.observedAt.getTime()===latest.observedAt.getTime()) {
      if(contentHash===latest.contentHash)return {status:'replayed',observation:latest,members,warnings:latest.warnings as MemberIdentityWarning[]};
      await audit('member_observation_conflict',{vendor_account_id:input.vendorAccountId,observed_at:input.observedAt.toISOString(),
        content_hash:contentHash,latest_observation_id:latest.id,warning:{kind:'member_observation_conflict'}});return {status:'conflict'};
    }
    const [observation]=await tx.insert(schema.memberObservation).values({id:createId(),vendorAccountId:input.vendorAccountId,source:input.source,
      observedAt:input.observedAt,contentHash,memberCount:members.filter(record=>record.membership_status==='member').length,
      invitedCount:members.filter(record=>record.membership_status==='invited').length,
      licensedCount:members.filter(record=>record.membership_status==='member'&&record.seat_evidence==='licensed'&&record.license_type_id!==null).length,
      warnings,correlationId:input.completeness.kind==='api'?input.completeness.pages[0]!.correlationId:null,acceptedAt:now,acceptedBy:input.actorUserAccountId}).returning();
    if(!observation)throw new Error('Observation insert returned no row');
    await audit('member_observation_accepted',{vendor_account_id:input.vendorAccountId,observation_id:observation.id,
      content_hash:contentHash,source:input.source,pages:input.completeness.kind==='api'?input.completeness.pages:[]});
    const event:MemberObservationAccepted={type:'member_observation_accepted',observation,members,warnings};
    for(const consumer of consumers)await consumer(tx,event);
    return {status:'accepted',observation,members,warnings};
  });
}
