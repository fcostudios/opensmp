import { randomUUID } from "node:crypto";

import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
import { createAnthropicConnector } from "@smp/connectors/providers/anthropic/connector";
import { createAnthropicRateLimiter } from "@smp/connectors/providers/anthropic/rate-limiter";
import {
  decryptCredential,
  readKekFile,
} from "@smp/db/credential-crypto";
import { createConnectorCallObservationAppender } from "@smp/db/connector-call-observations";
import { applyRequestTransitionInTransaction } from "@smp/db/request-transition";
import * as schema from "@smp/db/schema";
import { parseCredentialEnvelope } from "@smp/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

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

type DeliveryJobOptions = Readonly<{
  allowedKekRoot?: string;
  connectionString: string;
  kekFile?: string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  transport?: (request: Request) => Promise<Response>;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const candidate = record(value);
  if (!candidate) return null;
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? candidate
    : null;
}

function provisionInstruction(candidate: Candidate): ProvisionInstruction {
  const payload = exact(candidate.rawRequest, [
    "checklistSteps", "context", "instruction", "operation", "protocol", "version",
  ]);
  const context = exact(payload?.context, ["companyId", "requestId"]);
  const instruction = exact(payload?.instruction, [
    "licenseTypeName", "personEmail", "requestId", "vendorAccountId",
  ]);
  if (
    !payload
    || !Array.isArray(payload.checklistSteps)
    || payload.checklistSteps.length !== 0
    || payload.operation !== "provision"
    || payload.protocol !== "rest"
    || payload.version !== 1
    || !context
    || context.companyId !== candidate.companyId
    || context.requestId !== candidate.requestId
    || !instruction
    || instruction.requestId !== candidate.requestId
    || instruction.vendorAccountId !== candidate.vendorAccountId
    || typeof instruction.licenseTypeName !== "string"
    || instruction.licenseTypeName.trim().length === 0
    || typeof instruction.personEmail !== "string"
    || !emailPattern.test(instruction.personEmail)
    || !uuidPattern.test(candidate.actionId)
  ) {
    throw new Error("AUTOMATED_INVITE_PAYLOAD_INVALID");
  }
  return {
    licenseTypeName: instruction.licenseTypeName,
    personEmail: instruction.personEmail,
  };
}

export function createAutomatedInviteDeliveryJob(options: DeliveryJobOptions) {
  const pool = new pg.Pool({ connectionString: options.connectionString });
  const observations = createConnectorCallObservationAppender(options.connectionString);
  const now = options.now ?? (() => new Date());
  const clock = { now: () => now().getTime() };
  const sleep = options.sleep
    ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const limiter = createAnthropicRateLimiter({
    clock,
    sleep,
  });
  const transport = options.transport ?? fetch;

  async function candidates(vendorAccountId: string): Promise<readonly Candidate[]> {
    if (!uuidPattern.test(vendorAccountId)) throw new Error("AUTOMATED_INVITE_VENDOR_INVALID");
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
       WHERE action.vendor_account_id=$1
         AND action.kind='invite'
         AND action.mode='automated'
         AND action.status='pending'
         AND request.state='provisioning'
         AND NOT EXISTS (
           SELECT 1 FROM connector_call_observation observation
           WHERE observation.provisioning_action_id=action.id
         )
       ORDER BY action.created_at,action.id
       LIMIT 10`,
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

  async function credentialsFor(vendorAccountId: string) {
    const path = options.kekFile?.trim();
    if (!path) throw new Error("LEDGER_CREDENTIAL_KEK_FILE is required");
    const kek = await readKekFile(path, { allowedRoot: options.allowedKekRoot });
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
      if (updated.rowCount !== 1) throw new Error("AUTOMATED_INVITE_ACTION_CONFLICT");
      const database = drizzle(client, { schema });
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

  async function deliver(candidate: Candidate, occurredAt: Date): Promise<boolean> {
    const client = await pool.connect();
    let locked = false;
    try {
      const acquired = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [candidate.actionId],
      );
      locked = acquired.rows[0]?.locked === true;
      if (!locked || !(await currentCandidate(client, candidate))) return false;
      const instruction = provisionInstruction(candidate);
      const credentials = await credentialsFor(candidate.vendorAccountId);
      const connector = createAnthropicConnector({
        credentialsFor: async (vendorAccountId) => {
          if (vendorAccountId !== candidate.vendorAccountId) {
            throw new Error("AUTOMATED_INVITE_VENDOR_CONFLICT");
          }
          return credentials;
        },
        observationSessionFor: async ({ vendorAccountId, requestId, operation }) => {
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
      if (!result.ok || result.value.vendorRef === null) return false;
      return finalize(client, candidate, result.value.vendorRef, occurredAt);
    } finally {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [candidate.actionId])
          .catch(() => undefined);
      }
      client.release();
    }
  }

  return Object.freeze({
    async close(): Promise<void> {
      await Promise.all([pool.end(), observations.close()]);
    },
    async drain(input: Readonly<{ at: Date; vendorAccountId: string }>): Promise<{ processed: number }> {
      if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) {
        throw new Error("AUTOMATED_INVITE_TIME_INVALID");
      }
      let processed = 0;
      for (const candidate of await candidates(input.vendorAccountId)) {
        if (await deliver(candidate, input.at)) processed += 1;
      }
      return { processed };
    },
  });
}
