import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { chmod,mkdtemp,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll,beforeAll,expect,test } from "vitest";
import { SMTPServer } from "smtp-server";
import { createPostgresFixture,type PostgresFixture } from "@smp/db/testing/postgres-container";
import { encryptCredential } from "@smp/db/credential-crypto";
import { listCurrentSeatPoolCounts } from "@smp/db/pool-snapshots";
import { serializeCredentialEnvelope } from "@smp/domain";
import { createSmtpMailer } from "@smp/notifications";
import { createLifecycleNotificationDispatcher } from "@smp/notifications/lifecycle-dispatcher";
import { createAutomaticInvitationExpiryJob } from "./automatic-invitation-expiry.js";
const at=new Date("2026-10-02T15:00:00Z"),sent=new Date("2026-09-20T15:00:00Z");
const kek=Uint8Array.from({length:32},(_,index)=>index+1);
let fixture:PostgresFixture,owner:pg.Client,privateRoot:string,kekFile:string;
beforeAll(async()=>{fixture=await createPostgresFixture();await fixture.migrate();owner=await fixture.connectAsOwner();privateRoot=await mkdtemp(join(tmpdir(),"expiry-kek-"));kekFile=join(privateRoot,"kek");await writeFile(kekFile,Buffer.from(kek).toString("base64"));await chmod(kekFile,0o400);await owner.query("UPDATE alert_rule SET enabled=false");},30000);
afterAll(async()=>{await owner?.end();await fixture?.stop();if(privateRoot)await rm(privateRoot,{recursive:true});});
async function seed(ids:Partial<{companyId:string;requestId:string;actionId:string;actorUserId:string;commandId:string}>={}) {
  const companyId=ids.companyId??randomUUID(),foreignCompanyId=randomUUID(), vendor=randomUUID(), vendorAccountId=randomUUID(),license=randomUUID(),person=randomUUID(),requestId=ids.requestId??randomUUID(),actionId=ids.actionId??randomUUID(),actorUserId=ids.actorUserId??randomUUID();
  await owner.query(`INSERT INTO company(id,name,code,type,status,created_at,created_by) VALUES($1,'Withdraw A',$3,'internal','active',$4,'00000000-0000-0000-0000-000000000001'),($2,'Withdraw B',$5,'internal','active',$4,'00000000-0000-0000-0000-000000000001')`,[companyId,foreignCompanyId,companyId, sent,foreignCompanyId]);
  await owner.query(`INSERT INTO user_account(id,email,idp_subject,global_role,status,created_at,created_by) VALUES($1,$2,$3,'group_admin','active',$4,'00000000-0000-0000-0000-000000000001')`,[actorUserId,actorUserId+'@test.example',actorUserId,sent]);
  await owner.query(`INSERT INTO vendor(id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by) VALUES($1,$1::uuid::text,'api','rest',true,true,false,false,'email','active',$2,'00000000-0000-0000-0000-000000000001')`,[vendor,sent]);
  await owner.query(`INSERT INTO vendor_account(id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by) VALUES($1,$2,'Withdraw account','automated',1,'active',$3,'00000000-0000-0000-0000-000000000001')`,[vendorAccountId,vendor,sent]);
  await owner.query(`INSERT INTO license_type(id,vendor_id,name,unit,status,created_at,created_by) VALUES($1,$2,'Withdraw seat','seat','active',$3,'00000000-0000-0000-0000-000000000001')`,[license,vendor,sent]);
  await owner.query(`INSERT INTO vendor_account_capacity(vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by) VALUES($1,$2,5,'2026-01-01',$3,'00000000-0000-0000-0000-000000000001')`,[vendorAccountId,license,sent]);
  await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,$2,'Withdraw person',$3,'active',$4,'00000000-0000-0000-0000-000000000001')`,[person,person+'@example.test',companyId,sent]);
  await owner.query(`INSERT INTO license_request(id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,'invited','Need seat',$7,'00000000-0000-0000-0000-000000000001')`,[requestId,'REQ-'+requestId,person,companyId,vendorAccountId,license,sent]);
  await owner.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,sent_at,created_at) VALUES($1,$2,$3,'invite','automated','sent','invite-pinned',$4,$4)`,[actionId,requestId,vendorAccountId,sent]);
  return {companyId,foreignCompanyId,vendorAccountId,requestId,actionId,actorUserId,person,license,commandId:ids.commandId??randomUUID(),note:"No longer needed"};
}

async function configured(threshold:unknown={hours:24,auto_withdraw_after_hours:48},requestId?:string){
 const input=await seed({requestId});const rule=randomUUID();
 await owner.query(`UPDATE license_request SET requested_by=$1 WHERE id=$2 AND company_id=$3`,[input.actorUserId,input.requestId,input.companyId]);
 await owner.query(`UPDATE user_account SET ui_language='en' WHERE id=$1`,[input.actorUserId]);
 await owner.query(`INSERT INTO alert_rule(id,type,scope_kind,company_id,threshold,channel,enabled,created_at,created_by) VALUES($1,'invite_unaccepted','company',$2,$3::jsonb,'email',true,$4,$5)`,[rule,input.companyId,JSON.stringify(threshold),at,input.actorUserId]);
 for(const kind of ['admin_scoped','analytics'] as const)await owner.query(`INSERT INTO integration_credential(vendor_account_id,kind,encrypted_secret,health,status,created_at,created_by) VALUES($1,$2,$3,'ok','active',$4,$5)`,[input.vendorAccountId,kind,serializeCredentialEnvelope(await encryptCredential(kind+'-key',kek,length=>Uint8Array.from({length},(_,index)=>index+1))),at,input.actorUserId]);
 return {...input,rule};
}
function jobFor(transport:(request:Request)=>Promise<Response>,now=()=>at){return createAutomaticInvitationExpiryJob({connectionString:fixture.appUrl,kekFile,allowedKekRoot:privateRoot,now,sleep:async()=>undefined,transport});}
function provider(calls:string[],beforeDelete?:()=>Promise<void>,status='pending',receipt:unknown={id:'invite-pinned',type:'invite_deleted'}){
 return async(request:Request)=>{
  expect(request.headers.get('x-api-key')).toBe('admin_scoped-key');
  const path=new URL(request.url).pathname;calls.push(request.method+' '+path);
  if(request.method==='DELETE'){await beforeDelete?.();return new Response(JSON.stringify(receipt),{status:200,headers:{'content-type':'application/json'}});}
  return new Response(JSON.stringify({data:[{id:'invite-pinned',type:'invite',email:'selected@example.test',status}],has_more:false,first_id:'invite-pinned',last_id:'invite-pinned'}),{headers:{'content-type':'application/json'}});
 };
}
async function available(input:Awaited<ReturnType<typeof configured>>){const [row]=await listCurrentSeatPoolCounts(owner,{operatingDate:'2026-10-02',asOf:at,vendorAccountId:input.vendorAccountId});return row.purchased-row.assigned-row.pendingInvites;}
async function expectUntouched(input:Awaited<ReturnType<typeof configured>>,before:number){
 expect((await owner.query(`SELECT state FROM license_request WHERE id=$1 AND company_id=$2`,[input.requestId,input.companyId])).rows).toEqual([{state:'invited'}]);
 expect((await owner.query(`SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1 AND to_state='deprovisioned'`,[input.requestId])).rows[0].count).toBe(0);
 expect(await available(input)).toBe(before);
}

test('the production job shares a refill budget across invitations and isolates accounts and tenants',async()=>{
 const first=await configured(),second=await configured(),other=await configured(),excluded=await configured();
 await owner.query(`UPDATE license_request SET vendor_account_id=$2,license_type_id=$3 WHERE id=$1 AND company_id=$4`,[second.requestId,first.vendorAccountId,first.license,second.companyId]);
 await owner.query(`UPDATE provisioning_action SET vendor_account_id=$2 WHERE id=$1 AND request_id=$3`,[second.actionId,first.vendorAccountId,second.requestId]);
 await owner.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[excluded.rule]);
 await owner.query(`UPDATE license_request SET vendor_account_id=$2,license_type_id=$3 WHERE id=$1 AND company_id=$4`,[excluded.requestId,first.vendorAccountId,first.license,excluded.companyId]);
 await owner.query(`UPDATE provisioning_action SET vendor_account_id=$2 WHERE id=$1 AND request_id=$3`,[excluded.actionId,first.vendorAccountId,excluded.requestId]);
 await owner.query(`UPDATE integration_credential SET encrypted_secret=$2 WHERE vendor_account_id=$1 AND kind='admin_scoped'`,[other.vendorAccountId,serializeCredentialEnvelope(await encryptCredential('other-admin-key',kek,length=>Uint8Array.from({length},(_,index)=>index+1)))]);
 let clockAt=new Date(at),lookup=0;
 const calls:{account:string;method:string;time:number}[]=[],sleeps:{milliseconds:number;calls:number}[]=[];
 const before=await available(first);
 const job=createAutomaticInvitationExpiryJob({connectionString:fixture.appUrl,kekFile,allowedKekRoot:privateRoot,now:()=>clockAt,
  sleep:async(milliseconds)=>{sleeps.push({milliseconds,calls:calls.length});clockAt=new Date(clockAt.getTime()+milliseconds);},
  transport:async(request)=>{
   const key=request.headers.get('x-api-key');expect(['admin_scoped-key','other-admin-key']).toContain(key);
   const account=key==='other-admin-key'?'other':'shared',url=new URL(request.url);
   calls.push({account,method:request.method,time:clockAt.getTime()});
   if(request.method==='DELETE'){expect(url.pathname).toBe('/v1/organizations/invites/invite-pinned');return new Response(JSON.stringify({id:'invite-pinned',type:'invite_deleted'}),{headers:{'content-type':'application/json'}});}
   expect(request.method).toBe('GET');expect(url.pathname).toBe('/v1/organizations/invites');expect(url.searchParams.get('limit')).toBe('1000');
   const continuation=url.searchParams.get('after_id');if(continuation===null)lookup++;
   const page=continuation===null?1:Number(continuation.split('-').at(-1))+1,total=account==='shared'?50:99;
   const id=page===total?'invite-pinned':`page-${lookup}-${page}`;
   return new Response(JSON.stringify({data:[{id,type:'invite',email:'selected@example.test',status:'pending'}],has_more:page<total,first_id:id,last_id:id}),{headers:{'content-type':'application/json'}});
  }});
 try{
  expect(await job.drain({at,vendorAccountId:first.vendorAccountId})).toEqual({processed:2});
  expect(sleeps).toEqual([{milliseconds:60000,calls:100}]);
  expect(calls).toHaveLength(102);expect(calls.slice(0,100).every(call=>call.time===at.getTime())).toBe(true);
  expect(calls.slice(100).map(call=>call.time)).toEqual([at.getTime()+60000,at.getTime()+60000]);
  expect(calls.filter(call=>call.method==='DELETE')).toHaveLength(2);
  expect(await available(first)-before).toBe(2);
  expect((await owner.query(`SELECT company_id,request_id,recipient_user_account_id FROM lifecycle_notification WHERE request_id=ANY($1::uuid[]) ORDER BY company_id`,[[first.requestId,second.requestId]])).rows).toEqual([
   {company_id:first.companyId,request_id:first.requestId,recipient_user_account_id:first.actorUserId},
   {company_id:second.companyId,request_id:second.requestId,recipient_user_account_id:second.actorUserId},
  ].sort((left,right)=>left.company_id.localeCompare(right.company_id)));
  await expectUntouched({...excluded,vendorAccountId:first.vendorAccountId,license:first.license},before+2);
  expect((await owner.query(`SELECT id FROM lifecycle_notification WHERE company_id=$1 AND request_id=$2`,[excluded.companyId,excluded.requestId])).rows).toEqual([]);
  expect(await job.drain({at:clockAt,vendorAccountId:other.vendorAccountId})).toEqual({processed:1});
  expect(calls.filter(call=>call.account==='other')).toHaveLength(100);expect(sleeps).toEqual([{milliseconds:60000,calls:100}]);
  expect(await job.drain({at:clockAt,vendorAccountId:first.vendorAccountId})).toEqual({processed:0});
 }finally{await job.close();}
},30000);

test('two runs reclaim one reservation with a durable null actor action and one real SMTP delivery',async()=>{
 const input=await configured(),calls:string[]=[],before=await available(input);
 await owner.query(`UPDATE provisioning_action SET sent_at=$2 WHERE id=$1`,[input.actionId,new Date(at.getTime()-48*3600000)]);
 let clockAt=new Date(at.getTime()-1);
 const job=jobFor(provider(calls),()=>clockAt);
 let messages=0,message='';
 const smtp=new SMTPServer({authOptional:true,disabledCommands:['AUTH','STARTTLS'],onData(stream,_session,callback){stream.on('data',chunk=>{message+=chunk.toString();});stream.on('end',()=>{messages++;callback();});}});
 smtp.listen(0,'127.0.0.1');await once(smtp.server,'listening');const address=smtp.server.address();if(!address||typeof address==='string')throw new Error('SMTP port unavailable');
 const dispatcher=createLifecycleNotificationDispatcher({connectionString:fixture.appUrl,mailer:createSmtpMailer(`smtp://127.0.0.1:${address.port}`),workerId:'expiry-demo',now:()=>at,publicOrigin:'https://ledger.test'});
 try{
   expect(await job.drain({at:clockAt,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});
   clockAt=new Date(at.getTime()+1);
   expect(await job.drain({at:clockAt,vendorAccountId:input.vendorAccountId.toUpperCase()})).toEqual({processed:1});
   expect(await job.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});
   expect(calls.filter(call=>call.startsWith('DELETE'))).toEqual(['DELETE /v1/organizations/invites/invite-pinned']);
   expect(await available(input)-before).toBe(1);
   expect((await owner.query(`SELECT actor_user_id,to_state,note FROM request_transition WHERE request_id=$1`,[input.requestId])).rows).toEqual([{actor_user_id:null,to_state:'deprovisioned',note:'Automatically withdrew the unaccepted invitation after its configured expiry window.'}]);
   const actions=(await owner.query(`SELECT status,raw_request FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows;
   expect(actions).toHaveLength(1);expect(actions[0].status).toBe('withdrawn');expect(actions[0].raw_request).toMatchObject({actorUserId:null,actorLabel:null,commandId:input.actionId,actionId:input.actionId,companyId:input.companyId,requestId:input.requestId,note:'Automatically withdrew the unaccepted invitation after its configured expiry window.'});
   expect((await owner.query(`SELECT company_id,recipient_user_account_id,request_state FROM lifecycle_notification WHERE request_id=$1`,[input.requestId])).rows).toEqual([{company_id:input.companyId,recipient_user_account_id:input.actorUserId,request_state:'deprovisioned'}]);
   expect(await dispatcher.drain({requestId:input.requestId})).toEqual({sent:1,failed:0,skipped:0});
   expect(await dispatcher.drain({requestId:input.requestId})).toEqual({sent:0,failed:0,skipped:0});
   expect(messages).toBe(1);expect(message).toContain('Invitation expired');
   expect((await owner.query(`SELECT count(*)::int AS count FROM audit_log WHERE company_id=$1 AND action='invitation.withdrawn' AND actor_user_id IS NULL`,[input.companyId])).rows[0].count).toBe(1);
   const {createAuthorizationRepository}=await import(new URL("../../../web/src/modules/identity-access/authorization.ts",import.meta.url).href);
   const {createRequestReadRepository}=await import(new URL("../../../web/src/modules/request-workflow/read-repository.ts",import.meta.url).href);
   const database=drizzle(owner),authorizationRepository=createAuthorizationRepository(database);
   const authorization=await authorizationRepository.load({subject:input.actorUserId});
   const reader=createRequestReadRepository(database,()=>at);
   const record=await reader.detail(authorization,input.requestId);
   expect(record.company.id).toBe(input.companyId);
   expect(record.actions.filter((action:{kind:string})=>action.kind==='withdraw_invite')).toHaveLength(1);
   const durable=record.actions.find((action:{kind:string})=>action.kind==='withdraw_invite');
   expect(durable.rawRequest).toMatchObject({actorUserId:null,actorLabel:null,commandId:input.actionId,note:'Automatically withdrew the unaccepted invitation after its configured expiry window.'});
   expect(record.timeline).toHaveLength(1);expect(record.timeline[0].actor).toBeNull();expect(record.timeline[0].to).toBe('deprovisioned');
   const foreignPerson=randomUUID();
   await owner.query(`INSERT INTO person(id,email,full_name,company_id,status,created_at,created_by) VALUES($1,'foreign@expiry.test','Foreign',$2,'active',$3,$4)`,[foreignPerson,input.foreignCompanyId,at,input.actorUserId]);
   await owner.query(`UPDATE user_account SET person_id=$1,global_role=NULL WHERE id=$2`,[foreignPerson,input.actorUserId]);
   const foreignAuthorization=await authorizationRepository.load({subject:input.actorUserId});
   expect(await reader.detail(foreignAuthorization,input.requestId)).toBeNull();
 }finally{await job.close();await dispatcher.close();await new Promise<void>((resolve,reject)=>smtp.close(error=>error?reject(error):resolve()));}
},30000);

test.each(['legacy','null','invalid','below','exact','disabled','foreign','account','inactive','latest','assigned','manual','requested','missing-requester','inactive-requester','bad-email'] as const)('%s never deletes or releases an excluded invitation',async(kind)=>{
 const threshold=kind==='legacy'?{hours:24}:kind==='null'?{hours:24,auto_withdraw_after_hours:null}:kind==='invalid'?{hours:24,auto_withdraw_after_hours:24}:{hours:24,auto_withdraw_after_hours:48};
 const input=await configured(threshold),calls:string[]=[];
 if(kind==='below'||kind==='exact')await owner.query(`UPDATE provisioning_action SET sent_at=$2 WHERE id=$1`,[input.actionId,new Date(at.getTime()-(kind==='exact'?48:47.999)*3600000)]);
 if(kind==='missing-requester')await owner.query(`UPDATE license_request SET requested_by=NULL WHERE id=$1 AND company_id=$2`,[input.requestId,input.companyId]);
 if(kind==='inactive-requester')await owner.query(`UPDATE user_account SET status='disabled' WHERE id=$1`,[input.actorUserId]);
 if(kind==='bad-email')await owner.query(`UPDATE user_account SET email='invalid' WHERE id=$1`,[input.actorUserId]);
 if(kind==='disabled')await owner.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[input.rule]);
 if(kind==='foreign')await owner.query(`UPDATE alert_rule SET company_id=$2 WHERE id=$1`,[input.rule,input.foreignCompanyId]);
 if(kind==='inactive')await owner.query(`UPDATE company SET status='inactive' WHERE id=$1`,[input.companyId]);
 if(kind==='latest')await owner.query(`INSERT INTO provisioning_action(request_id,vendor_account_id,kind,mode,status,created_at) VALUES($1,$2,'invite','automated','pending',$3)`,[input.requestId,input.vendorAccountId,at]);
 if(kind==='assigned')await owner.query(`INSERT INTO license_assignment(person_id,company_id,vendor_account_id,license_type_id,started_on,source_request_id,source_kind,created_at) VALUES($1,$2,$3,$4,'2026-10-02',$5,'request',$6)`,[input.person,input.companyId,input.vendorAccountId,input.license,input.requestId,at]);
 if(kind==='manual'||kind==='requested')await owner.query(`INSERT INTO provisioning_action(request_id,vendor_account_id,kind,mode,status,vendor_ref,raw_request,created_at) VALUES($1,$2,'withdraw_invite','automated','pending','invite-pinned',$3::jsonb,$4)`,[input.requestId,input.vendorAccountId,JSON.stringify({...input,commandId:input.actionId,actorUserId:kind==='manual'?input.actorUserId:null,actorLabel:kind==='manual'?'Manual administrator':null,note:kind==='requested'?'Automatically withdrew the unaccepted invitation after its configured expiry window.':'Existing intent'}),at]);
 const before=await available(input),job=jobFor(provider(calls));
 try{expect(await job.drain({at,vendorAccountId:kind==='account'?randomUUID():input.vendorAccountId})).toEqual({processed:0});expect(calls).toEqual([]);await expectUntouched(input,before);}finally{await job.close();}
},30000);

test.each([true,false])('receipt replay preserves its note after outbox failure with disabled rules=%s',async(disableRule)=>{
 const input=await configured(),calls:string[]=[],before=await available(input),name='expiry_fault_'+input.requestId.replaceAll('-','');
 await owner.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'EXPIRY_NOTICE_FAULT';END $$;CREATE TRIGGER ${name} BEFORE INSERT ON lifecycle_notification FOR EACH ROW WHEN(NEW.request_id='${input.requestId}'::uuid) EXECUTE FUNCTION ${name}();`);
 const job=jobFor(provider(calls));
 try{await expect(job.drain({at,vendorAccountId:input.vendorAccountId})).rejects.toThrow('EXPIRY_NOTICE_FAULT');await expectUntouched(input,before);}finally{await owner.query(`DROP TRIGGER ${name} ON lifecycle_notification;DROP FUNCTION ${name}();`);await job.close();}
 if(disableRule)await owner.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[input.rule]);await owner.query(`UPDATE user_account SET ui_language='es' WHERE id=$1`,[input.actorUserId]);
 const replay=jobFor(provider(calls));
 try{expect(await replay.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:1});expect(await replay.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});}finally{await replay.close();}
 expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(1);
 expect((await owner.query(`SELECT note FROM request_transition WHERE request_id=$1`,[input.requestId])).rows).toEqual([{note:'Automatically withdrew the unaccepted invitation after its configured expiry window.'}]);
 expect((await owner.query(`SELECT count(*)::int AS count FROM lifecycle_notification WHERE company_id=$1 AND request_id=$2`,[input.companyId,input.requestId])).rows[0].count).toBe(1);
 expect(await available(input)-before).toBe(1);
},30000);


test.each(['disabled','invalid','scope','type','acceptance','replacement','requester','company'] as const)('fresh expiry rechecks %s after waiting on the real invitation lock',async(change)=>{
 const input=await configured(),calls:string[]=[],barrier=await fixture.connectAsApp();
 await barrier.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[input.actionId]);
 const job=jobFor(provider(calls)),pending=job.drain({at,vendorAccountId:input.vendorAccountId});
 try{
   const deadline=Date.now()+10000;
   for(;;){const result=await owner.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`);if(result.rows[0].waiting)break;if(Date.now()>deadline)throw new Error('Expiry never waited on original invitation lock');await new Promise<void>(resolve=>setImmediate(resolve));}
   if(change==='disabled')await owner.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[input.rule]);
   if(change==='invalid')await owner.query(`UPDATE alert_rule SET threshold='{"hours":24,"auto_withdraw_after_hours":24}' WHERE id=$1`,[input.rule]);
   if(change==='scope')await owner.query(`UPDATE alert_rule SET company_id=$2 WHERE id=$1`,[input.rule,input.foreignCompanyId]);
   if(change==='type')await owner.query(`UPDATE alert_rule SET type='approval_aging' WHERE id=$1`,[input.rule]);
   if(change==='requester')await owner.query(`UPDATE user_account SET status='disabled' WHERE id=$1`,[input.actorUserId]);
   if(change==='company')await owner.query(`UPDATE company SET status='inactive' WHERE id=$1`,[input.companyId]);
   if(change==='acceptance')await owner.query(`UPDATE provisioning_action SET status='confirmed',resolved_at=$2 WHERE id=$1`,[input.actionId,at]);
   if(change==='replacement')await owner.query(`INSERT INTO provisioning_action(request_id,vendor_account_id,kind,mode,status,created_at) VALUES($1,$2,'invite','automated','pending',$3)`,[input.requestId,input.vendorAccountId,at]);
   const changedBefore=await available(input);
   await barrier.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[input.actionId]);
   expect(await pending).toEqual({processed:0});expect(calls).toEqual([]);
   expect((await owner.query(`SELECT count(*)::int AS count FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows[0].count).toBe(0);
   expect((await owner.query(`SELECT count(*)::int AS count FROM request_transition WHERE request_id=$1 AND to_state='deprovisioned'`,[input.requestId])).rows[0].count).toBe(0);
   expect(await available(input)).toBe(changedBefore);
 }finally{await barrier.query('SELECT pg_advisory_unlock_all()');await barrier.end();await pending;await job.close();}
},30000);

test.each(['accepted','ambiguous','unsupported'] as const)('provider %s retains the reservation and never removes an active member',async(kind)=>{
 const input=await configured(),calls:string[]=[],before=await available(input);
 if(kind==='unsupported')await owner.query(`UPDATE vendor SET provisioning_protocol='scim' WHERE id=(SELECT vendor_id FROM vendor_account WHERE id=$1)`,[input.vendorAccountId]);
 const job=jobFor(provider(calls,undefined,kind==='accepted'?'accepted':'pending',kind==='ambiguous'?{id:'wrong',type:'invite_deleted'}:undefined));
 try{expect(await job.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});expect(await job.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});await expectUntouched(input,before);expect(calls.some(call=>call.includes('/users'))).toBe(false);expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(kind==='ambiguous'?1:0);}finally{await job.close();}
},30000);

test.each(['global','vendor_account'] as const)('applies enabled valid %s rules only within their scheduled account',async(scope)=>{
 const input=await configured(),calls:string[]=[];
 await owner.query(`UPDATE alert_rule SET enabled=false WHERE id<>$1`,[input.rule]);
 if(scope==='global'){await owner.query(`DELETE FROM alert_rule WHERE scope_kind='global' AND type='invite_unaccepted'`);await owner.query(`UPDATE alert_rule SET scope_kind='global',company_id=NULL WHERE id=$1`,[input.rule]);}
 else await owner.query(`UPDATE alert_rule SET scope_kind='vendor_account',company_id=NULL,vendor_account_id=$2 WHERE id=$1`,[input.rule,input.vendorAccountId]);
 const job=jobFor(provider(calls));
 try{expect(await job.drain({at,vendorAccountId:randomUUID()})).toEqual({processed:0});expect(calls).toEqual([]);expect(await job.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:1});expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(1);}finally{await job.close();}
},30000);


test('requester loss after provider receipt rolls back completion and restores from receipt without another DELETE',async()=>{
 const input=await configured(),calls:string[]=[],before=await available(input);
 const job=jobFor(provider(calls,async()=>{await owner.query(`UPDATE user_account SET status='disabled' WHERE id=$1`,[input.actorUserId]);}));
 try{await expect(job.drain({at,vendorAccountId:input.vendorAccountId})).rejects.toThrow('INVITATION_EXPIRY_NOTIFICATION_MISSING');await expectUntouched(input,before);expect((await owner.query(`SELECT status,raw_response FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows).toEqual([{status:'pending',raw_response:{id:'invite-pinned',type:'invite_deleted'}}]);}finally{await job.close();}
 await owner.query(`UPDATE user_account SET status='active' WHERE id=$1`,[input.actorUserId]);await owner.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[input.rule]);
 const replay=jobFor(provider(calls));try{expect(await replay.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:1});}finally{await replay.close();}
 expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(1);
 expect((await owner.query(`SELECT count(*)::int AS count FROM lifecycle_notification WHERE request_id=$1 AND company_id=$2`,[input.requestId,input.companyId])).rows[0].count).toBe(1);
 expect(await available(input)-before).toBe(1);
},30000);


test('rejects malformed scheduled time and account before any tenant or provider work',async()=>{
 const input=await configured(),calls:string[]=[],job=jobFor(provider(calls));
 try{
   await expect(job.drain({at:new Date(NaN),vendorAccountId:input.vendorAccountId})).rejects.toThrow('AUTOMATIC_INVITATION_EXPIRY_TIME_INVALID');
   for(const invalid of ['invalid','x'+input.vendorAccountId,input.vendorAccountId+'x'])await expect(job.drain({at,vendorAccountId:invalid})).rejects.toThrow('AUTOMATIC_INVITATION_EXPIRY_VENDOR_INVALID');
   expect(calls).toEqual([]);
   expect((await owner.query(`SELECT count(*)::int AS count FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows[0].count).toBe(0);
 }finally{await job.close();}
},30000);


test.each(['manual','different-command','wrong-request','non-string-note','padded-note','invalid-receipt'] as const)('never adopts a %s receipt as automatic expiry',async(kind)=>{
 const input=await configured(),calls:string[]=[],before=await available(input);
 await owner.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[input.rule]);
 const command={companyId:input.companyId,requestId:kind==='wrong-request'?randomUUID():input.requestId,actionId:input.actionId,commandId:kind==='different-command'?randomUUID():input.actionId,actorUserId:kind==='manual'?input.actorUserId:null,actorLabel:kind==='manual'?'Manual administrator':null,note:kind==='non-string-note'?42:kind==='padded-note'?'  Existing intent  ':'Existing intent'};
 await owner.query(`INSERT INTO provisioning_action(request_id,vendor_account_id,kind,mode,status,vendor_ref,raw_request,raw_response,created_at) VALUES($1,$2,'withdraw_invite','automated','pending','invite-pinned',$3::jsonb,$4::jsonb,$5)`,[input.requestId,input.vendorAccountId,JSON.stringify(command),JSON.stringify({id:kind==='invalid-receipt'?'wrong':'invite-pinned',type:'invite_deleted'}),at]);
 const job=jobFor(provider(calls));
 try{expect(await job.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});expect(calls).toEqual([]);await expectUntouched(input,before);expect((await owner.query(`SELECT status,raw_request FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite'`,[input.requestId])).rows).toEqual([{status:'pending',raw_request:command}]);}finally{await job.close();}
},30000);

test('receipt recovery respects the scheduled vendor account before a global drain',async()=>{
 const input=await configured(),calls:string[]=[],before=await available(input);
 await owner.query(`UPDATE alert_rule SET enabled=false`);
 const command={companyId:input.companyId,requestId:input.requestId,actionId:input.actionId,commandId:input.actionId,actorUserId:null,actorLabel:null,note:'Existing expiry intent'};
 await owner.query(`INSERT INTO provisioning_action(request_id,vendor_account_id,kind,mode,status,vendor_ref,raw_request,raw_response,created_at) VALUES($1,$2,'withdraw_invite','automated','pending','invite-pinned',$3::jsonb,$4::jsonb,$5)`,[input.requestId,input.vendorAccountId,JSON.stringify(command),JSON.stringify({id:'invite-pinned',type:'invite_deleted'}),at]);
 const job=jobFor(provider(calls));
 try{expect(await job.drain({at,vendorAccountId:randomUUID()})).toEqual({processed:0});await expectUntouched(input,before);expect(await job.drain({at})).toEqual({processed:1});expect(calls).toEqual([]);expect(await available(input)-before).toBe(1);expect((await owner.query(`SELECT company_id,recipient_user_account_id FROM lifecycle_notification WHERE request_id=$1`,[input.requestId])).rows).toEqual([{company_id:input.companyId,recipient_user_account_id:input.actorUserId}]);}finally{await job.close();}
},30000);

test('holds the applicable rule through preparation commit',async()=>{
 const input=await configured(),calls:string[]=[],barrier=await fixture.connectAsApp(),updater=await fixture.connectAsOwner();
 const name='expiry_lock_'+input.requestId.replaceAll('-',''),key='expiry-preparation-'+input.actionId;
 await barrier.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[key]);
 await owner.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_lock(hashtextextended('${key}',0));PERFORM pg_advisory_unlock(hashtextextended('${key}',0));RETURN NEW;END $$;CREATE TRIGGER ${name} BEFORE INSERT ON provisioning_action FOR EACH ROW WHEN(NEW.request_id='${input.requestId}'::uuid AND NEW.kind='withdraw_invite') EXECUTE FUNCTION ${name}();`);
 const updaterPid=(await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const job=jobFor(provider(calls)),pending=job.drain({at,vendorAccountId:input.vendorAccountId});let update:Promise<unknown>|undefined,updateFinished=false;
 async function waitFor(query:string,parameters:unknown[]=[]){const deadline=Date.now()+10000;for(;;){if(updateFinished||(await owner.query(query,parameters)).rows[0].waiting)return;if(Date.now()>deadline)throw new Error('Expected database lock did not appear');await new Promise<void>(resolve=>setImmediate(resolve));}}
 try{
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`);
  update=updater.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[input.rule]).finally(()=>{updateFinished=true;});
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND state='active') AS waiting`,[updaterPid]);
  expect((await owner.query(`SELECT pg_blocking_pids($1)::int[] AS blockers`,[updaterPid])).rows[0].blockers).not.toEqual([]);
  await barrier.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);
  expect(await pending).toEqual({processed:1});await update;
  expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(1);
  expect((await owner.query(`SELECT enabled FROM alert_rule WHERE id=$1`,[input.rule])).rows).toEqual([{enabled:false}]);
 }finally{await barrier.query('SELECT pg_advisory_unlock_all()');await pending;await update;await job.close();await barrier.end();await updater.end();await owner.query(`DROP TRIGGER ${name} ON provisioning_action;DROP FUNCTION ${name}();`);}
},30000);


test('closing the job ends its real pool before another valid drain',async()=>{
 const calls:string[]=[],job=jobFor(provider(calls));
 await job.close();
 await expect(job.drain({at})).rejects.toThrow('Cannot use a pool after calling end on the pool');
 expect(calls).toEqual([]);
},30000);


test('the initial scan reaches the original invitation lock before waiting on a rule writer',async()=>{
 const input=await configured(),calls:string[]=[],writer=await fixture.connectAsOwner();
 await writer.query('BEGIN');await writer.query(`UPDATE alert_rule SET threshold=threshold WHERE id=$1`,[input.rule]);
 const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const job=jobFor(provider(calls)),pending=job.drain({at,vendorAccountId:input.vendorAccountId});
 try{
  const deadline=Date.now()+10000;
  for(;;){if((await owner.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pg_blocking_pids(pid) @> ARRAY[$1::int]) AS waiting`,[writerPid])).rows[0].waiting)break;if(Date.now()>deadline)throw new Error('Expiry never waited behind the rule writer');await new Promise<void>(resolve=>setImmediate(resolve));}
  expect((await owner.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS available',[input.actionId])).rows[0].available).toBe(false);
  expect(calls).toEqual([]);
  await writer.query('COMMIT');
  expect(await pending).toEqual({processed:1});
  expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(1);
  expect((await owner.query(`SELECT company_id,recipient_user_account_id FROM lifecycle_notification WHERE request_id=$1`,[input.requestId])).rows).toEqual([{company_id:input.companyId,recipient_user_account_id:input.actorUserId}]);
 }finally{await owner.query('SELECT pg_advisory_unlock_all()');await writer.query('ROLLBACK');await pending;await job.close();await writer.end();}
},30000);


test.each([true,false])('stored request identity must stay canonical with enabled rule=%s',async(enabled)=>{
 for(const kind of ['wrong','missing','uppercase'] as const){
  const input=await configured({hours:24,auto_withdraw_after_hours:48},'abcdefab-'+randomUUID().slice(9)),calls:string[]=[],before=await available(input);
  if(!enabled)await owner.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[input.rule]);
  const command:Record<string,unknown>={companyId:input.companyId,requestId:kind==='wrong'?randomUUID():input.requestId.toUpperCase(),actionId:input.actionId,commandId:input.actionId,actorUserId:null,actorLabel:null,note:'Automatically withdrew the unaccepted invitation after its configured expiry window.'};
  if(kind==='missing')delete command.requestId;
  const withdrawalId=randomUUID(),receipt={id:'invite-pinned',type:'invite_deleted'};
  await owner.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,raw_request,raw_response,created_at) VALUES($1,$2,$3,'withdraw_invite','automated','pending','invite-pinned',$4::jsonb,$5::jsonb,$6)`,[withdrawalId,input.requestId,input.vendorAccountId,JSON.stringify(command),JSON.stringify(receipt),at]);
  const job=jobFor(provider(calls));
  try{expect(await job.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});expect(calls).toEqual([]);await expectUntouched(input,before);expect((await owner.query(`SELECT status,raw_request,raw_response FROM provisioning_action WHERE id=$1 AND request_id=$2`,[withdrawalId,input.requestId])).rows).toEqual([{status:'pending',raw_request:command,raw_response:receipt}]);expect((await owner.query(`SELECT status FROM provisioning_action WHERE id=$1 AND request_id=$2`,[input.actionId,input.requestId])).rows).toEqual([{status:'sent'}]);expect((await owner.query(`SELECT id FROM lifecycle_notification WHERE company_id=$1 AND request_id=$2`,[input.companyId,input.requestId])).rows).toEqual([]);expect((await owner.query(`SELECT id FROM audit_log WHERE company_id=$1 AND action='invitation.withdrawn'`,[input.companyId])).rows).toEqual([]);}finally{await job.close();}
 }
},30000);

test('a later coherent receipt cannot replace an earlier coherent localized recovery',async()=>{
 const input=await configured({hours:24,auto_withdraw_after_hours:48},'abcdefab-'+randomUUID().slice(9)),calls:string[]=[],before=await available(input),early=randomUUID(),late=randomUUID();
 await owner.query(`UPDATE alert_rule SET enabled=false WHERE id=$1`,[input.rule]);
 const english='Automatically withdrew the unaccepted invitation after its configured expiry window.',spanish='Se retiró automáticamente la invitación no aceptada al vencer el plazo configurado.';
 const command={companyId:input.companyId,requestId:input.requestId,actionId:input.actionId,commandId:input.actionId,actorUserId:null,actorLabel:null,note:english},receipt={id:'invite-pinned',type:'invite_deleted'};
 for(const [id,note,created] of [[early,english,at],[late,spanish,new Date(at.getTime()+1)]] as const)await owner.query(`INSERT INTO provisioning_action(id,request_id,vendor_account_id,kind,mode,status,vendor_ref,raw_request,raw_response,created_at) VALUES($1,$2,$3,'withdraw_invite','automated','pending','invite-pinned',$4::jsonb,$5::jsonb,$6)`,[id,input.requestId,input.vendorAccountId,JSON.stringify({...command,note}),JSON.stringify(receipt),created]);
 const job=jobFor(provider(calls));
 try{expect(await job.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:1});expect(await job.drain({at,vendorAccountId:input.vendorAccountId})).toEqual({processed:0});expect(calls).toEqual([]);expect(await available(input)-before).toBe(1);expect((await owner.query(`SELECT id,status,raw_request->>'note' AS note,raw_request->>'requestId' AS request_id,raw_response FROM provisioning_action WHERE request_id=$1 AND kind='withdraw_invite' ORDER BY created_at,id`,[input.requestId])).rows).toEqual([{id:early,status:'withdrawn',note:english,request_id:input.requestId,raw_response:receipt},{id:late,status:'pending',note:spanish,request_id:input.requestId,raw_response:receipt}]);expect((await owner.query(`SELECT actor_user_id,note,to_state FROM request_transition WHERE request_id=$1`,[input.requestId])).rows).toEqual([{actor_user_id:null,note:english,to_state:'deprovisioned'}]);expect((await owner.query(`SELECT company_id,recipient_user_account_id FROM lifecycle_notification WHERE company_id=$1 AND request_id=$2`,[input.companyId,input.requestId])).rows).toEqual([{company_id:input.companyId,recipient_user_account_id:input.actorUserId}]);}finally{await job.close();}
},30000);
