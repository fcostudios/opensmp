import { randomUUID } from "node:crypto";

import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
import type { MemberPageCursor, MemberPageResume } from "@smp/connectors";
import { decryptCredential, encryptCredential, readKekFile } from "@smp/db/credential-crypto";
import { createConnectorCallObservationAppender } from "@smp/db/connector-call-observations";
import { applyRequestTransitionInTransaction } from "@smp/db/request-transition";
import { ecuadorOperatingDate, parseCredentialEnvelope, serializeCredentialEnvelope } from "@smp/domain";
import { assertLegalTransition } from "@smp/domain/request-workflow";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { createMembershipPollingConnector, createProvisioningRateLimiter } from "../connector-composition.js";

type Candidate = Readonly<{
  actionId: string;
  companyId: string;
  licenseTypeId: string;
  personEmail: string;
  personId: string;
  rawResponse: unknown;
  requestId: string;
  vendorAccountId: string;
}>;

type PublicEvidence = Readonly<{
  complete: boolean;
  cursor: MemberPageCursor | null;
  memberSetSize: number;
  pageCount: number;
}>;

type Checkpoint = Readonly<{
  cursor: MemberPageCursor | null;
  resume: MemberPageResume | null;
}>;

export type MembershipPollJobOptions = Readonly<{
  allowedKekRoot?: string;
  connectionString: string;
  kekFile?: string;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  transport: (request: Request) => Promise<Response>;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ? value as Record<string, unknown>
    : null;
}

function publicCursor(value: unknown): MemberPageCursor {
  const record = asRecord(value);
  if (!record || Object.keys(record).sort().join(",") !== "memberSetSize,pageCount,stream") {
    throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
  }
  if (
    (record.stream !== "members" && record.stream !== "invitations")
    || !Number.isSafeInteger(record.pageCount) || (record.pageCount as number) < 1 || (record.pageCount as number) >= 100
    || !Number.isSafeInteger(record.memberSetSize) || (record.memberSetSize as number) < 0
  ) throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
  return record as MemberPageCursor;
}

function evidence(value: PublicEvidence, resume?: string): { membershipPoll: PublicEvidence & { resume?: string } } {
  return {
    membershipPoll: {
      complete: value.complete,
      cursor: value.cursor,
      memberSetSize: value.memberSetSize,
      pageCount: value.pageCount,
      resume,
    },
  };
}

export async function decodeMembershipPollCheckpoint(
  rawResponse: unknown,
  vendorAccountId: string,
  kek: Uint8Array,
): Promise<Checkpoint> {
  if (rawResponse === null) return { cursor: null, resume: null };
  const root = asRecord(rawResponse);
  const stored = root && asRecord(root.membershipPoll);
  if (!stored) throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
  if (stored.complete === true) {
    if (Object.keys(stored).sort().join(",") !== "complete,cursor,memberSetSize,pageCount"
      || stored.cursor !== null || !Number.isSafeInteger(stored.pageCount)
      || (stored.pageCount as number) < 1 || (stored.pageCount as number) > 100
      || !Number.isSafeInteger(stored.memberSetSize) || (stored.memberSetSize as number) < 0) {
      throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
    }
    return { cursor: null, resume: null };
  }
  const allowed = "complete,cursor,memberSetSize,pageCount,resume";
  if (Object.keys(stored).sort().join(",") !== allowed) {
    throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
  }
  if (stored.complete !== false || typeof stored.resume !== "string") {
    throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
  }
  const cursor = publicCursor(stored.cursor);
  if (stored.pageCount !== cursor.pageCount || stored.memberSetSize !== cursor.memberSetSize) {
    throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
  }
  let resume: unknown;
  try {
    resume = JSON.parse(await decryptCredential(parseCredentialEnvelope(stored.resume), kek));
  } catch {
    throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
  }
  const decoded = asRecord(resume);
  if (!decoded || decoded.vendorAccountId !== vendorAccountId) {
    throw new Error("MEMBERSHIP_POLL_CHECKPOINT_INVALID");
  }
  return { cursor, resume: decoded as MemberPageResume };
}

export function createMembershipPollJob(options: MembershipPollJobOptions) {
  const pool = new pg.Pool({ connectionString: options.connectionString });
  const observations = createConnectorCallObservationAppender(options.connectionString);
  const now = options.now;
  const clock = { now: () => now().getTime() };
  const sleep = options.sleep;
  const transport = options.transport;
  const limiter = createProvisioningRateLimiter({ clock, sleep });

  async function candidates(vendorAccountId?: string): Promise<readonly Candidate[]> {
    const result = await pool.query<Candidate>(
      `SELECT action.id::text AS "actionId",request.id::text AS "requestId",
              request.company_id::text AS "companyId",request.license_type_id::text AS "licenseTypeId",
              request.vendor_account_id::text AS "vendorAccountId",person.id::text AS "personId",
              lower(person.email) AS "personEmail",action.raw_response AS "rawResponse"
       FROM provisioning_action action
       JOIN license_request request ON request.id=action.request_id
          AND request.vendor_account_id=action.vendor_account_id
       JOIN person ON person.id=request.person_id AND person.company_id=request.company_id
       JOIN vendor_account account ON account.id=request.vendor_account_id
          AND account.mode='automated' AND account.status='active'
       JOIN vendor ON vendor.id=account.vendor_id AND vendor.connector_type='api'
          AND vendor.provisioning_protocol='rest' AND vendor.can_provision AND vendor.status='active'
       WHERE ($1::uuid IS NULL OR action.vendor_account_id=$1::uuid)
         AND action.kind='invite' AND action.mode='automated' AND action.status='sent'
         AND request.state='invited'
       ORDER BY action.created_at,action.id`,
      [vendorAccountId ?? null],
    );
    return result.rows;
  }

  async function loadCredentials(vendorAccountId: string, kek: Uint8Array) {
    const result = await pool.query<{ encryptedSecret: string; kind: "admin_scoped" | "analytics"; health: "ok" | "auth_failed" | "unverified"; status: "active" | "retired" }>(
      `SELECT encrypted_secret AS "encryptedSecret",kind::text,health::text,status::text
       FROM integration_credential WHERE vendor_account_id=$1::uuid AND status='active' ORDER BY kind`,
      [vendorAccountId],
    );
    return await Promise.all(result.rows.map(async (credential) => ({
      ...credential,
      secret: await decryptCredential(parseCredentialEnvelope(credential.encryptedSecret), kek),
      vendorAccountId,
    })));
  }

  async function saveCheckpoint(client: pg.PoolClient, candidate: Candidate, page: PublicEvidence, resume: MemberPageResume | null, kek: Uint8Array): Promise<boolean> {
    const encrypted = resume === null ? undefined : serializeCredentialEnvelope(
      await encryptCredential(JSON.stringify(resume), kek),
    );
    // One UPDATE is its own atomic transaction; no explicit transaction can be
    // left open when the checkpoint write fails.
    const updated = await client.query(
        `UPDATE provisioning_action action SET raw_response=$4::jsonb
         FROM license_request request
         WHERE action.id=$1::uuid AND action.request_id=$2::uuid AND action.vendor_account_id=$3::uuid
           AND action.kind='invite' AND action.mode='automated' AND action.status='sent'
           AND request.id=action.request_id AND request.company_id=$5::uuid AND request.state='invited'
         RETURNING action.id`,
        [candidate.actionId, candidate.requestId, candidate.vendorAccountId, JSON.stringify(evidence(page, encrypted)), candidate.companyId],
    );
    return updated.rowCount === 1;
  }

  async function activate(client: pg.PoolClient, candidate: Candidate, page: PublicEvidence, occurredAt: Date): Promise<boolean> {
    await client.query("BEGIN");
    try {
      const locked = await client.query<{
        companyId: string; licenseTypeId: string; personId: string; requestId: string; vendorAccountId: string;
      }>(
        `SELECT request.id::text AS "requestId",request.company_id::text AS "companyId",
                request.vendor_account_id::text AS "vendorAccountId",request.license_type_id::text AS "licenseTypeId",
                request.person_id::text AS "personId"
         FROM provisioning_action action
         JOIN license_request request ON request.id=action.request_id AND request.vendor_account_id=action.vendor_account_id
         JOIN person ON person.id=request.person_id AND person.company_id=request.company_id
         WHERE action.id=$1::uuid AND action.request_id=$2::uuid AND action.vendor_account_id=$3::uuid
           AND request.company_id=$4::uuid AND lower(person.email)=$5
           AND action.kind='invite' AND action.mode='automated' AND action.status='sent'
           AND request.state='invited' AND request.license_assignment_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM license_assignment assignment WHERE assignment.source_request_id=request.id AND assignment.source_kind='request')
         FOR UPDATE OF action,request`,
        [candidate.actionId, candidate.requestId, candidate.vendorAccountId, candidate.companyId, candidate.personEmail],
      );
      const [current] = locked.rows;
      if (!current) {
        await client.query("ROLLBACK");
        return false;
      }
      const assignmentId = randomUUID();
      const startedOn = ecuadorOperatingDate(occurredAt);
      await client.query(
        `INSERT INTO license_assignment (id,person_id,company_id,vendor_account_id,license_type_id,started_on,source_request_id,source_kind,note,created_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::date,$7::uuid,'request','Membership poll accepted invitation',$8)`,
        [assignmentId, current.personId, current.companyId, current.vendorAccountId, current.licenseTypeId, startedOn, current.requestId, occurredAt],
      );
      const linked = await client.query(
        `UPDATE license_request SET license_assignment_id=$2::uuid,updated_at=$3
         WHERE id=$1::uuid AND company_id=$4::uuid AND state='invited' AND license_assignment_id IS NULL RETURNING id`,
        [current.requestId, assignmentId, occurredAt, current.companyId],
      );
      if (linked.rowCount !== 1) throw new Error("MEMBERSHIP_POLL_ASSIGNMENT_CONFLICT");
      const confirmed = await client.query(
        `UPDATE provisioning_action SET status='confirmed',raw_response=$2::jsonb,resolved_at=$3
         WHERE id=$1::uuid AND status='sent' RETURNING id`,
        [candidate.actionId, JSON.stringify(evidence(page)), occurredAt],
      );
      if (confirmed.rowCount !== 1) throw new Error("MEMBERSHIP_POLL_ACTION_CONFLICT");
      const database = drizzle(client);
      assertLegalTransition("invited", "active");
      await applyRequestTransitionInTransaction(database, {
        requestId: current.requestId, from: "invited", to: "active", actorUserId: null,
        note: "Membership poll accepted invitation", occurredAt,
      }, { expectedCompanyId: current.companyId });
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  async function poll(candidate: Candidate, kek: Uint8Array, credentials: Awaited<ReturnType<typeof loadCredentials>>, occurredAt: Date): Promise<boolean> {
    const client = await pool.connect();
    let advisoryLock = false;
    try {
      const acquired = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [candidate.actionId]);
      advisoryLock = acquired.rows[0]?.locked === true;
      if (!advisoryLock) return false;
      let checkpoint = await decodeMembershipPollCheckpoint(candidate.rawResponse, candidate.vendorAccountId, kek);
      const connector = createMembershipPollingConnector({
        credentialsFor: async () => credentials,
        observationSessionFor: async () => createConnectorCallObservationSession({ vendorAccountId: candidate.vendorAccountId, provisioningActionId: null, operation: "sync_members", clock: now, randomId: randomUUID, append: observations.append }),
        requestDependencies: { clock, sleep, limiter, transport },
      });
      while (true) {
        const result = await connector.syncMemberPage({ vendorAccountId: candidate.vendorAccountId, observedAt: occurredAt, ...checkpoint });
        if (!result.ok) return false;
        const page: PublicEvidence = {
          complete: result.value.complete,
          cursor: result.value.cursor,
          memberSetSize: result.value.memberSetSize,
          pageCount: result.value.pageCount,
        };
        const accepted = result.value.members.some((member) => member.active && member.email.toLowerCase() === candidate.personEmail);
        if (accepted) return await activate(client, candidate, { ...page, cursor: null }, occurredAt);
        if (!(await saveCheckpoint(client, candidate, page, result.value.resume, kek)) || page.complete) return false;
        checkpoint = { cursor: result.value.cursor, resume: result.value.resume };
      }
    } finally {
      if (advisoryLock) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [candidate.actionId]).catch(() => undefined);
      client.release();
    }
  }

  return Object.freeze({
    async close(): Promise<void> { await Promise.all([pool.end(), observations.close()]); },
    async drain(input: Readonly<{ at: Date; vendorAccountId?: string }>): Promise<{ processed: number }> {
      if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) throw new Error("MEMBERSHIP_POLL_TIME_INVALID");
      if (input.vendorAccountId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.vendorAccountId)) throw new Error("MEMBERSHIP_POLL_VENDOR_INVALID");
      const path = options.kekFile?.trim();
      if (!path) throw new Error("LEDGER_CREDENTIAL_KEK_FILE is required");
      const kek = await readKekFile(path, { allowedRoot: options.allowedKekRoot });
      let processed = 0;
      for (const candidate of await candidates(input.vendorAccountId)) {
        const credentials = await loadCredentials(candidate.vendorAccountId, kek);
        if (await poll(candidate, kek, credentials, input.at)) processed += 1;
      }
      return { processed };
    },
  });
}
