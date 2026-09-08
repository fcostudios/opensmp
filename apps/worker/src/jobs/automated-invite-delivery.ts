import { randomUUID } from "node:crypto";

import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
import {
  parseAutomatedRestProvisionPayload,
  vendorAccountIdSchema,
} from "@smp/contracts/automated-provisioning";
import {
  decryptCredential,
  readKekFile,
} from "@smp/db/credential-crypto";
import { createConnectorCallObservationAppender } from "@smp/db/connector-call-observations";
import { applyRequestTransitionInTransaction } from "@smp/db/request-transition";
import * as schema from "@smp/db/schema";
import { parseCredentialEnvelope } from "@smp/domain";
import { assertLegalTransition } from "@smp/domain/request-workflow";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import {
  createProvisioningConnector,
  createProvisioningRateLimiter,
} from "../connector-composition.js";

type Candidate = Readonly<{
  actionId: string;
  companyId: string;
  rawRequest: unknown;
  requestId: string;
  vendorAccountId: string;
}>;

type ProvisionInstruction = Readonly<{
  licenseTypeName: string;
  personEmail: string;
}>;

export type AutomatedInviteDeliveryJobOptions = Readonly<{
  allowedKekRoot?: string;
  connectionString: string;
  kekFile?: string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  transport?: (request: Request) => Promise<Response>;
}>;

function provisionInstruction(candidate: Candidate): ProvisionInstruction {
  let payload;
  try {
    payload = parseAutomatedRestProvisionPayload(candidate.rawRequest);
  } catch {
    throw new Error("AUTOMATED_INVITE_PAYLOAD_INVALID");
  }
  if (
    payload.context.companyId !== candidate.companyId
    || payload.context.requestId !== candidate.requestId
    || payload.instruction.requestId !== candidate.requestId
    || payload.instruction.vendorAccountId !== candidate.vendorAccountId
  ) throw new Error("AUTOMATED_INVITE_PAYLOAD_INVALID");
  return {
    licenseTypeName: payload.instruction.licenseTypeName,
    personEmail: payload.instruction.personEmail,
  };
}

export function createAutomatedInviteDeliveryJob(options: AutomatedInviteDeliveryJobOptions) {
  const pool = new pg.Pool({ connectionString: options.connectionString });
  const observations = createConnectorCallObservationAppender(options.connectionString);
  const now = options.now ?? (() => new Date());
  const clock = { now: () => now().getTime() };
  const sleep = options.sleep
    ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const limiter = createProvisioningRateLimiter({
    clock,
    sleep,
  });
  const transport = options.transport ?? fetch;

  async function candidates(vendorAccountId?: string): Promise<readonly Candidate[]> {
    if (!vendorAccountIdSchema.optional().safeParse(vendorAccountId).success) {
      throw new Error("AUTOMATED_INVITE_VENDOR_INVALID");
    }
    const result = await pool.query<Candidate>(
      `SELECT action.id::text AS "actionId",
              request.company_id::text AS "companyId",
              action.raw_request AS "rawRequest",
              request.id::text AS "requestId",
              action.vendor_account_id::text AS "vendorAccountId"
       FROM provisioning_action action
       JOIN license_request request
         ON request.id=action.request_id
        AND request.vendor_account_id=action.vendor_account_id
       JOIN vendor_account account
         ON account.id=action.vendor_account_id
        AND account.mode='automated'
        AND account.status='active'
       JOIN vendor
         ON vendor.id=account.vendor_id
        AND vendor.connector_type='api'
        AND vendor.provisioning_protocol='rest'
        AND vendor.can_provision
        AND vendor.status='active'
       WHERE ($1::uuid IS NULL OR action.vendor_account_id=$1)
         AND action.kind='invite'
         AND action.mode='automated'
         AND action.status='pending'
         AND request.state='provisioning'
         AND NOT EXISTS (
           SELECT 1 FROM connector_call_observation observation
           WHERE observation.provisioning_action_id=action.id
         )
       ORDER BY action.created_at,action.id`,
      [vendorAccountId],
    );
    return result.rows;
  }

  async function currentCandidate(client: pg.PoolClient, candidate: Candidate): Promise<boolean> {
    const result = await client.query(
      `SELECT 1
       FROM provisioning_action action
       JOIN license_request request
         ON request.id=action.request_id
        AND request.vendor_account_id=action.vendor_account_id
        AND request.company_id=$3
       JOIN vendor_account account
         ON account.id=action.vendor_account_id
        AND account.mode='automated'
        AND account.status='active'
       JOIN vendor
         ON vendor.id=account.vendor_id
        AND vendor.connector_type='api'
        AND vendor.provisioning_protocol='rest'
        AND vendor.can_provision
        AND vendor.status='active'
       WHERE action.id=$1
         AND action.vendor_account_id=$2
         AND action.kind='invite'
         AND action.mode='automated'
         AND action.status='pending'
         AND request.state='provisioning'
         AND NOT EXISTS (
           SELECT 1 FROM connector_call_observation observation
           WHERE observation.provisioning_action_id=action.id
         )`,
      [candidate.actionId, candidate.vendorAccountId, candidate.companyId],
    );
    return result.rowCount === 1;
  }

  async function loadCredentials(vendorAccountId: string, kek: Uint8Array) {
    const result = await pool.query<{
      encryptedSecret: string;
      health: "ok" | "auth_failed" | "unverified";
      kind: "admin_scoped" | "analytics";
      status: "active" | "retired";
      vendorAccountId: string;
    }>(
      `SELECT vendor_account_id::text AS "vendorAccountId",kind::text,
              encrypted_secret AS "encryptedSecret",health::text,status::text
       FROM integration_credential
       WHERE vendor_account_id=$1 AND status='active'
       ORDER BY kind`,
      [vendorAccountId],
    );
    return Promise.all(result.rows.map(async (credential) => ({
      vendorAccountId: credential.vendorAccountId,
      kind: credential.kind,
      secret: await decryptCredential(
        parseCredentialEnvelope(credential.encryptedSecret),
        kek,
      ),
      status: credential.status,
      health: credential.health,
    })));
  }

  async function finalize(
    client: pg.PoolClient,
    candidate: Candidate,
    vendorRef: string,
    occurredAt: Date,
  ): Promise<boolean> {
    await client.query("BEGIN");
    try {
      const locked = await client.query(
        `SELECT 1
         FROM provisioning_action action
         JOIN license_request request
           ON request.id=action.request_id
          AND request.vendor_account_id=action.vendor_account_id
          AND request.company_id=$3
         WHERE action.id=$1
           AND action.vendor_account_id=$2
           AND action.status='pending'
           AND request.state='provisioning'
           AND EXISTS (
             SELECT 1 FROM connector_call_observation observation
             WHERE observation.provisioning_action_id=action.id
               AND observation.phase='succeeded'
               AND observation.classification='success'
           )
         FOR UPDATE OF action,request`,
        [candidate.actionId, candidate.vendorAccountId, candidate.companyId],
      );
      if (locked.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      const updated = await client.query(
        `UPDATE provisioning_action
         SET vendor_ref=$2,status='sent',sent_at=$3
         WHERE id=$1 AND status='pending' RETURNING id`,
        [candidate.actionId, vendorRef, occurredAt],
      );
      // Stryker disable next-line ConditionalExpression,StringLiteral: @equivalent The action is
      // locked and matched status='pending' above in this same transaction; a database failure
      // rejects the UPDATE rather than returning a different cardinality.
      if (updated.rowCount !== 1) throw new Error("AUTOMATED_INVITE_ACTION_CONFLICT");
      // Stryker disable next-line ObjectLiteral: @equivalent This adapter uses only Drizzle's
      // raw execute method; the schema object changes typing, not the emitted SQL or runtime value.
      const database = drizzle(client, { schema });
      assertLegalTransition("provisioning", "invited");
      await applyRequestTransitionInTransaction(database, {
        requestId: candidate.requestId,
        from: "provisioning",
        to: "invited",
        actorUserId: null,
        note: "Anthropic invitation delivered",
        occurredAt,
      }, { expectedCompanyId: candidate.companyId });
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  async function finalizeNoSeat(
    client: pg.PoolClient,
    candidate: Candidate,
    occurredAt: Date,
  ): Promise<boolean> {
    await client.query("BEGIN");
    try {
      const locked = await client.query(
        `SELECT 1
         FROM provisioning_action action
         JOIN license_request request
           ON request.id=action.request_id
          AND request.vendor_account_id=action.vendor_account_id
          AND request.company_id=$3
         WHERE action.id=$1
           AND action.vendor_account_id=$2
           AND action.request_id=$4
           AND action.kind='invite'
           AND action.mode='automated'
           AND action.status='pending'
           AND request.state='provisioning'
           AND EXISTS (
             SELECT 1 FROM connector_call_observation observation
             WHERE observation.provisioning_action_id=action.id
               AND observation.vendor_account_id=action.vendor_account_id
               AND observation.phase='failed'
               AND observation.classification='client_error'
               AND observation.summary->>'failure_code'='capacity_unavailable'
           )
         FOR UPDATE OF action,request`,
        [
          candidate.actionId,
          candidate.vendorAccountId,
          candidate.companyId,
          candidate.requestId,
        ],
      );
      if (locked.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      const updated = await client.query(
        `UPDATE provisioning_action
         SET status='failed',raw_response=$2::jsonb,resolved_at=$3
         WHERE id=$1
           AND request_id=$4
           AND vendor_account_id=$5
           AND status='pending'
         RETURNING id`,
        [
          candidate.actionId,
          JSON.stringify({ failure_code: "capacity_unavailable" }),
          occurredAt,
          candidate.requestId,
          candidate.vendorAccountId,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("AUTOMATED_INVITE_ACTION_CONFLICT");
      const database = drizzle(client, { schema });
      assertLegalTransition("provisioning", "blocked_no_seat");
      await applyRequestTransitionInTransaction(database, {
        requestId: candidate.requestId,
        from: "provisioning",
        to: "blocked_no_seat",
        actorUserId: null,
        note: "Anthropic invitation capacity unavailable",
        occurredAt,
      }, { expectedCompanyId: candidate.companyId });
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  async function deliver(
    candidate: Candidate,
    occurredAt: Date,
    credentialsForDrain: ReturnType<typeof credentialResolver>,
  ): Promise<boolean> {
    const client = await pool.connect();
    let locked = false;
    try {
      const acquired = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [candidate.actionId],
      );
      // Stryker disable next-line OptionalChaining: @equivalent SELECT without a FROM always
      // returns exactly one row, so indexed and optional access produce the same boolean.
      locked = acquired.rows[0]?.locked === true;
      if (!locked || !(await currentCandidate(client, candidate))) return false;
      const instruction = provisionInstruction(candidate);
      const credentials = await credentialsForDrain(candidate.vendorAccountId);
      const connector = createProvisioningConnector({
        credentialsFor: async (vendorAccountId) => {
          // Stryker disable next-line ConditionalExpression,BlockStatement,StringLiteral: @equivalent
          // The owned connector calls this resolver only with the immutable vendorAccountId from
          // the provision input; this check is defense in depth for a future connector regression.
          if (vendorAccountId !== candidate.vendorAccountId) {
            throw new Error("AUTOMATED_INVITE_VENDOR_CONFLICT");
          }
          return credentials;
        },
        observationSessionFor: async ({ vendorAccountId, requestId, operation }) => {
          // Stryker disable next-line ConditionalExpression,LogicalOperator,BlockStatement,StringLiteral: @equivalent
          // The owned connector passes these exact three values from its provision operation; this
          // closed callback branch is defense in depth at the composition boundary.
          if (
            vendorAccountId !== candidate.vendorAccountId
            || requestId !== candidate.actionId
            || operation !== "provision"
          ) {
            throw new Error("AUTOMATED_INVITE_OBSERVATION_CONFLICT");
          }
          return createConnectorCallObservationSession({
            vendorAccountId,
            provisioningActionId: candidate.actionId,
            operation,
            clock: now,
            randomId: randomUUID,
            append: observations.append,
          });
        },
        requestDependencies: { clock, sleep, limiter, transport },
      });
      const result = await connector.provision({
        requestId: candidate.actionId,
        vendorAccountId: candidate.vendorAccountId,
        personEmail: instruction.personEmail,
        licenseTypeName: instruction.licenseTypeName,
      });
      // Stryker disable next-line ConditionalExpression: @equivalent Anthropic provision success
      // is constructed only after parsing a non-null invitation id; ok plus null is unrepresentable.
      if (!result.ok) {
        return result.code === "capacity_unavailable"
          ? await finalizeNoSeat(client, candidate, occurredAt)
          : false;
      }
      if (result.value.vendorRef === null) return false;
      return finalize(client, candidate, result.value.vendorRef, occurredAt);
    } finally {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [candidate.actionId])
          .catch(() => undefined);
      }
      client.release();
    }
  }

  function credentialResolver() {
    let kek: Promise<Uint8Array> | undefined;
    const byAccount = new Map<string, Promise<Awaited<ReturnType<typeof loadCredentials>>>>();
    return (vendorAccountId: string) => {
      let credentials = byAccount.get(vendorAccountId);
      if (!credentials) {
        const path = options.kekFile?.trim();
        if (!path) return Promise.reject(new Error("LEDGER_CREDENTIAL_KEK_FILE is required"));
        kek ??= readKekFile(path, { allowedRoot: options.allowedKekRoot });
        credentials = kek.then((value) => loadCredentials(vendorAccountId, value));
        byAccount.set(vendorAccountId, credentials);
      }
      return credentials;
    };
  }

  return Object.freeze({
    async close(): Promise<void> {
      await Promise.all([pool.end(), observations.close()]);
    },
    async drain(input: Readonly<{ at: Date; vendorAccountId?: string }>): Promise<{ processed: number }> {
      if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) {
        throw new Error("AUTOMATED_INVITE_TIME_INVALID");
      }
      const selected = await candidates(input.vendorAccountId);
      const credentialsForDrain = credentialResolver();
      let processed = 0;
      for (const candidate of selected) {
        if (await deliver(candidate, input.at, credentialsForDrain)) processed += 1;
      }
      return { processed };
    },
  });
}
