import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import { createSmtpMailer } from "@smp/notifications";
import { SMTPServer } from "smtp-server";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlertEvaluationJob } from "./evaluate-alerts.js";

let fixture: PostgresFixture;
let owner: pg.Client;
const companyA = randomUUID(), companyB = randomUUID(), vendor = randomUUID(), account = randomUUID(), license = randomUUID(), rule = randomUUID();
const at = new Date("2026-10-02T15:07:00Z");
const requests: Record<string, string> = {};
const actions: Record<string, string> = {};
beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  await owner.query("UPDATE alert_rule SET enabled=false");
  await owner.query(`INSERT INTO company (id,name,code,type,status,created_at,created_by)
    VALUES ($1,'Invite A','INV067A','internal','active',$3,'00000000-0000-0000-0000-000000000001'),
           ($2,'Invite B','INV067B','internal','active',$3,'00000000-0000-0000-0000-000000000001')`, [companyA,companyB,at]);
  await owner.query(`INSERT INTO vendor (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
    VALUES ($1,'Invite vendor','api','rest',true,true,false,false,'email','active',$2,'00000000-0000-0000-0000-000000000001')`, [vendor,at]);
  await owner.query(`INSERT INTO vendor_account (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
    VALUES ($1,$2,'Invite account','automated',1,'active',$3,'00000000-0000-0000-0000-000000000001')`, [account,vendor,at]);
  await owner.query(`INSERT INTO license_type (id,vendor_id,name,unit,status,created_at,created_by)
    VALUES ($1,$2,'Seat','seat','active',$3,'00000000-0000-0000-0000-000000000001')`, [license,vendor,at]);
  for (const [name, age, company, status] of [
    ['below',167.999,companyA,'sent'],['exact',168,companyA,'sent'],['above',168.001,companyA,'sent'],
    ['foreign',200,companyB,'sent'],['withdrawn',200,companyA,'withdrawn'],['accepted',200,companyA,'confirmed'],
    ['superseded',200,companyA,'sent'],['race',200,companyA,'sent'],
  ] as const) {
    const person = randomUUID(), request = randomUUID(), action = randomUUID();
    requests[name] = request; actions[name] = action;
    const sent = new Date(at.getTime()-age*3600000);
    const created = new Date(sent.getTime()-86400000);
    const enteredInvited = new Date(sent.getTime()+120000);
    await owner.query(`INSERT INTO person (id,email,full_name,company_id,status,created_at,created_by)
      VALUES ($1,$2,$3,$4,'active',$5,'00000000-0000-0000-0000-000000000001')`,[person,`${name}@invite.test`,name,company,sent]);
    await owner.query(`INSERT INTO license_request (id,request_no,person_id,company_id,vendor_account_id,license_type_id,state,justification,created_at,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,'invited','Invite evidence',$7,'00000000-0000-0000-0000-000000000001')`,[request,`REQ-067-${name}`,person,company,account,license,sent]);
    await owner.query(`INSERT INTO request_transition (request_id,from_state,to_state,occurred_at) VALUES ($1,'provisioning','invited',$2)`,[request,enteredInvited]);
    await owner.query(`INSERT INTO provisioning_action (id,request_id,vendor_account_id,kind,mode,status,vendor_ref,sent_at,resolved_at,created_at)
      VALUES ($1,$2,$3,'invite','automated',$4,$5,$6,$7,$8)`,[action,request,account,status,`inv-${name}`,sent,status==='sent'?null:at,created]);
    if (name==='superseded') await owner.query(`INSERT INTO provisioning_action (request_id,vendor_account_id,kind,mode,status,created_at)
      VALUES ($1,$2,'invite','automated','pending',$3)`,[request,account,at]);
  }
  await owner.query(`INSERT INTO alert_rule (id,type,scope_kind,company_id,threshold,channel,enabled,created_at,created_by)
    VALUES ($1,'invite_unaccepted','company',$2,'{"hours":168}','email',true,$3,'00000000-0000-0000-0000-000000000001'),
      (gen_random_uuid(),'invite_unaccepted','company',$4,'{"hours":168}','email',false,$3,'00000000-0000-0000-0000-000000000001')`,[rule,companyA,at,companyB]);
},120000);
beforeEach(async () => {
  await owner.query("TRUNCATE alert_event CASCADE");
  await owner.query("UPDATE alert_rule SET enabled=false");
  await owner.query("UPDATE alert_rule SET type='invite_unaccepted',threshold='{\"hours\":168}',enabled=true WHERE id=$1",[rule]);
  for (const [name, action] of Object.entries(actions)) {
    const status = name === 'withdrawn' ? 'withdrawn' : name === 'accepted' ? 'confirmed' : 'sent';
    await owner.query("UPDATE provisioning_action SET status=$2,resolved_at=$3 WHERE id=$1",[action,status,status==='sent'?null:at]);
  }
});
afterAll(async () => { await owner?.end(); await fixture?.stop(); });

test('alerts only strict overdue current invitations and preserves one event across windows and concurrent runs', async () => {
  // Removing current-action filtering, exact-time evaluation, or stable deduplication breaks this oracle.
  await owner.query("UPDATE provisioning_action SET status='withdrawn',resolved_at=$2 WHERE id=$1",[actions.race,at]);
  let messages = 0;
  const smtp = new SMTPServer({authOptional:true,disabledCommands:['AUTH','STARTTLS'],onData(stream,_session,callback){
    stream.on('data',()=>undefined); stream.on('end',()=>{messages++;callback();});
  }});
  smtp.listen(0,'127.0.0.1'); await once(smtp.server,'listening');
  const address=smtp.server.address(); if (!address || typeof address==='string') throw new Error('SMTP port unavailable');
  const job=createAlertEvaluationJob({connectionString:fixture.appUrl,mailer:createSmtpMailer(`smtp://127.0.0.1:${address.port}`),workerId:'invite-067'});
  try {
    const firstRuns = await Promise.all([job.run(at),job.run(at)]);
    expect(firstRuns.reduce((sum,run)=>sum+run.processed,0)).toBe(1);
    const first=await owner.query(`SELECT id,subject_ref FROM alert_event WHERE alert_rule_id=$1`,[rule]);
    expect(first.rows.map(row=>row.subject_ref)).toEqual([{requestId:requests.above}]);
    // Keep the boundary fixtures below threshold on later windows so only the same breach remains.
    await owner.query("UPDATE provisioning_action SET status='withdrawn',resolved_at=$2 WHERE id=ANY($1::uuid[])",[[actions.below,actions.exact],at]);
    await expect(job.run(new Date('2026-10-02T15:22:00Z'))).resolves.toMatchObject({status:'succeeded',processed:0});
    await Promise.all([job.run(new Date('2026-10-02T15:37:00Z')),job.run(new Date('2026-10-02T15:37:00Z'))]);
    const repeated=await owner.query(`SELECT id FROM alert_event WHERE alert_rule_id=$1`,[rule]);
    expect(repeated.rows).toEqual(first.rows.map(({id})=>({id})));
    expect(messages).toBe(1);
    const successes=await owner.query(`SELECT count(*)::int AS count FROM alert_notification_delivery d JOIN alert_event e ON e.id=d.alert_event_id WHERE e.alert_rule_id=$1 AND d.phase='succeeded'`,[rule]);
    expect(successes.rows).toEqual([{count:1}]);
    await owner.query('UPDATE alert_rule SET enabled=false WHERE id=$1',[rule]);
    await expect(job.run(new Date('2026-10-03T15:07:00Z'))).resolves.toMatchObject({processed:0});
  } finally {await job.close();await new Promise<void>((resolve,reject)=>smtp.close(error=>error?reject(error):resolve()));}
},30000);


test.each(['acceptance','rule-type-change','rule-disabled','invalid-rule'] as const)("revalidates a gathered invitation after %s holds the action lock", async (change) => {
  await owner.query("UPDATE provisioning_action SET status='withdrawn',resolved_at=$2 WHERE id=ANY($1::uuid[])",[[actions.below,actions.exact,actions.above],at]);
  await owner.query("UPDATE alert_rule SET enabled=true WHERE id=$1",[rule]);
  await owner.query("UPDATE provisioning_action SET status='sent',resolved_at=NULL WHERE id=$1",[actions.race]);
  const membership = await fixture.connectAsApp();
  await membership.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[actions.race]);
  const job=createAlertEvaluationJob({connectionString:fixture.appUrl,workerId:'invite-race-067'});
  const pending=job.run(at);
  try {
    // Observe the lock wait rather than guessing that the evaluator has gathered facts.
    const deadline=Date.now()+10000;
    for (;;) {
      const waiting=await owner.query(`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`);
      if (waiting.rows[0].waiting) break;
      if (Date.now()>deadline) throw new Error('Evaluator never waited for membership action lock');
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    await membership.query("BEGIN");
    await membership.query(`SELECT action.id FROM provisioning_action action JOIN license_request request ON request.id=action.request_id
      WHERE action.id=$1 AND request.company_id=$2 FOR UPDATE OF action,request`,[actions.race,companyA]);
    if (change==='acceptance') {
      await membership.query("UPDATE provisioning_action SET status='confirmed',resolved_at=$2 WHERE id=$1",[actions.race,at]);
    } else if (change==='rule-type-change') {
      await owner.query("UPDATE alert_rule SET type='approval_aging',threshold='{\"hours\":24,\"escalationHours\":48}' WHERE id=$1",[rule]);
    } else if (change==='rule-disabled') {
      await owner.query("UPDATE alert_rule SET enabled=false WHERE id=$1",[rule]);
    } else {
      await owner.query("UPDATE alert_rule SET threshold='{\"hours\":\"invalid\"}' WHERE id=$1",[rule]);
    }
    await membership.query("COMMIT");
    await membership.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[actions.race]);
    await expect(pending).resolves.toMatchObject({processed:0,status:change==='invalid-rule'?'failed':'succeeded'});
    const released=await membership.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[actions.race]);
    expect(released.rows[0].acquired).toBe(true);
    await membership.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[actions.race]);
    const events=await owner.query(`SELECT id FROM alert_event WHERE alert_rule_id=$1 AND subject_ref->>'requestId'=$2`,[rule,requests.race]);
    expect(events.rows).toEqual([]);
  } finally {
    await membership.query("SELECT pg_advisory_unlock_all()"); await membership.end();
    await pending; await job.close();
  }
},30000);


test("holds action and request locks through actual outbox persistence", async () => {
  await owner.query("UPDATE provisioning_action SET status='withdrawn',resolved_at=$2 WHERE id=ANY($1::uuid[])",[[actions.below,actions.exact,actions.above],at]);
  await owner.query(`CREATE FUNCTION pause_invite_outbox_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('us067-outbox-persistence',0)); RETURN NEW; END $$;
    CREATE TRIGGER pause_invite_outbox_test BEFORE INSERT ON alert_event FOR EACH ROW EXECUTE FUNCTION pause_invite_outbox_test()`);
  await owner.query("SELECT pg_advisory_lock(hashtextextended('us067-outbox-persistence',0))");
  const monitor=await fixture.connectAsApp();
  const smtp = new SMTPServer({authOptional:true,disabledCommands:['AUTH','STARTTLS'],onData(stream,_session,callback){stream.on('data',()=>undefined);stream.on('end',callback);}});
  smtp.listen(0,'127.0.0.1'); await once(smtp.server,'listening');
  const address=smtp.server.address(); if (!address || typeof address==='string') throw new Error('SMTP port unavailable');
  const job=createAlertEvaluationJob({connectionString:fixture.appUrl,mailer:createSmtpMailer(`smtp://127.0.0.1:${address.port}`),workerId:'invite-persistence-067'});
  const pending=job.run(at);
  try {
    const deadline=Date.now()+10000;
    for (;;) {
      const waiting=await owner.query("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting");
      if(waiting.rows[0].waiting) break;
      if(Date.now()>deadline) throw new Error('Outbox never reached persistence barrier');
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    const actionLock=await monitor.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",[actions.race]);
    expect(actionLock.rows[0].acquired).toBe(false);
    await monitor.query('BEGIN');
    await expect(monitor.query("SELECT id FROM license_request WHERE id=$1 AND company_id=$2 FOR UPDATE NOWAIT",[requests.race,companyA])).rejects.toMatchObject({code:'55P03'});
    await monitor.query('ROLLBACK');
    await monitor.query('BEGIN');
    await expect(monitor.query("SELECT action.id FROM provisioning_action action JOIN license_request request ON request.id=action.request_id WHERE action.id=$1 AND request.company_id=$2 FOR UPDATE OF action NOWAIT",[actions.race,companyA])).rejects.toMatchObject({code:'55P03'});
    await monitor.query('ROLLBACK');
    await owner.query("SELECT pg_advisory_unlock(hashtextextended('us067-outbox-persistence',0))");
    await expect(pending).resolves.toMatchObject({status:'succeeded',processed:1});
    const events=await owner.query("SELECT count(*)::int AS count FROM alert_event WHERE alert_rule_id=$1 AND subject_ref->>'requestId'=$2",[rule,requests.race]);
    expect(events.rows).toEqual([{count:1}]);
  } finally {
    await monitor.query('ROLLBACK'); await monitor.query('SELECT pg_advisory_unlock_all()'); await monitor.end();
    await owner.query("SELECT pg_advisory_unlock(hashtextextended('us067-outbox-persistence',0))");
    await pending; await job.close();
    await owner.query('DROP TRIGGER pause_invite_outbox_test ON alert_event; DROP FUNCTION pause_invite_outbox_test()');
    await new Promise<void>((resolve,reject)=>smtp.close(error=>error?reject(error):resolve()));
  }
},30000);

test("preserves quarter-hour snapshot facts for other alerts", async () => {
  await owner.query('UPDATE alert_rule SET enabled=false');
  await owner.query("UPDATE provisioning_action SET status='withdrawn',resolved_at=$1",[at]);
  await owner.query(`INSERT INTO vendor_account_capacity
    (vendor_account_id,license_type_id,purchased_qty,effective_from,created_at,created_by)
    VALUES ($1,$2,2,'2026-10-01','2026-10-02T14:00:00Z','00000000-0000-0000-0000-000000000001'),
           ($1,$2,0,'2026-10-02','2026-10-02T15:05:00Z','00000000-0000-0000-0000-000000000001')`,[account,license]);
  const poolRule=randomUUID();
  await owner.query(`INSERT INTO alert_rule (id,type,scope_kind,vendor_account_id,threshold,channel,enabled,created_at,created_by)
    VALUES ($1,'low_pool','vendor_account',$2,'{"floor":1}','email',true,$3,'00000000-0000-0000-0000-000000000001')`,[poolRule,account,at]);
  const job=createAlertEvaluationJob({connectionString:fixture.appUrl,workerId:'invite-preserve-window-067'});
  try {
    await expect(job.run(at)).resolves.toMatchObject({status:'succeeded',processed:0});
    const events=await owner.query('SELECT id FROM alert_event WHERE alert_rule_id=$1',[poolRule]);
    expect(events.rows).toEqual([]);
  } finally { await job.close(); }
},30000);
