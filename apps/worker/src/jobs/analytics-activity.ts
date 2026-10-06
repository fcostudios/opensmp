import { randomUUID } from "node:crypto";
import { createConnectorDispatcher } from "@smp/connectors";
import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
import { ingestActivityBatch, resolveActivityScopes } from "@smp/db/analytics-ingestion";
import { decryptCredential, readKekFile } from "@smp/db/credential-crypto";
import { createConnectorCallObservationAppender } from "@smp/db/connector-call-observations";
import * as schema from "@smp/db/schema";
import { SYSTEM_USER_ID } from "@smp/db/system-ids";
import { parseCredentialEnvelope } from "@smp/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createMembershipPollingConnector, createProvisioningRateLimiter } from "../connector-composition.js";

type Options = Readonly<{
 connectionString: string; allowedKekRoot?: string; kekFile?: string;
 now: () => Date; sleep: (milliseconds: number) => Promise<void>;
 transport: (request: Request) => Promise<Response>;
}>;
type Account = { id: string; protocol: string; identityMatching: string };

export function createAnalyticsActivityJob(options: Options) {
 const pool = new pg.Pool({ connectionString: options.connectionString });
 // Constructors allocate no connections. Keep later initialization inside drain
 // so its caller already owns the close boundary when initialization fails.
 const observations = createConnectorCallObservationAppender(options.connectionString);
 const clock = { now: () => options.now().getTime() };
 const limiter = createProvisioningRateLimiter({ clock, sleep: options.sleep });
 return Object.freeze({
  async close(): Promise<void> { await Promise.all([pool.end(), observations.close()]); },
  async drain(input: { at: Date; vendorAccountId?: string }): Promise<{ processed: number }> {
   if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) throw new Error("ACTIVITY_TIME_INVALID");
   if (input.vendorAccountId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.vendorAccountId)) throw new Error("ACTIVITY_VENDOR_INVALID");
   const accounts = await pool.query<Account>(`SELECT account.id::text, vendor.provisioning_protocol::text AS protocol, vendor.identity_matching::text AS "identityMatching"
    FROM vendor_account account JOIN vendor ON vendor.id=account.vendor_id
    WHERE account.status='active' AND vendor.status='active' AND account.ingestion_mode='api'
      AND vendor.connector_type='api' AND vendor.has_usage_data
      AND ($1::uuid IS NULL OR account.id=$1::uuid) ORDER BY account.id`, [input.vendorAccountId ?? null]);
   if (!accounts.rows.length) return { processed: 0 };
   const eligible = accounts.rows.filter(account => {
    const supported = account.protocol === "rest" && account.identityMatching === "email";
    if (!supported && input.vendorAccountId) throw new Error("ACTIVITY_ACCOUNT_UNSUPPORTED");
    return supported;
   });
   if (!eligible.length) return { processed: 0 };
   const path = options.kekFile?.trim();
   if (!path) throw new Error("LEDGER_CREDENTIAL_KEK_FILE is required");
   const kek = await readKekFile(path, { allowedRoot: options.allowedKekRoot });
   const observedAt = new Date(Date.UTC(input.at.getUTCFullYear(), input.at.getUTCMonth(), input.at.getUTCDate() - 3));
   const activityDate = observedAt.toISOString().slice(0, 10);
   const companies = await pool.query<{ id: string }>("SELECT id::text FROM company WHERE status='active' ORDER BY id");
   const trustedCompanyIds = companies.rows.map(company => company.id);
   let processed = 0;
   for (const account of eligible) {
    // Pin attempt freshness before the external wait: a slow older attempt
    // must not overwrite a newer observation that finishes first.
    const syncedAt = options.now();
    const stored = await pool.query<{ encryptedSecret: string; kind: "analytics" | "admin_scoped"; health: "ok" | "auth_failed" | "unverified"; status: "active" }>(`SELECT encrypted_secret AS "encryptedSecret",kind::text,health::text,status::text FROM integration_credential WHERE vendor_account_id=$1::uuid AND status='active'`, [account.id]);
    const credentials = await Promise.all(stored.rows.map(async credential => ({ ...credential, vendorAccountId: account.id, secret: await decryptCredential(parseCredentialEnvelope(credential.encryptedSecret), kek) })));
    const connector = createConnectorDispatcher({ rest: createMembershipPollingConnector({
     credentialsFor: async () => credentials,
     observationSessionFor: async () => createConnectorCallObservationSession({ vendorAccountId: account.id, provisioningActionId: null, operation: "sync_activity", clock: options.now, randomId: randomUUID, append: observations.append }),
     requestDependencies: { clock, sleep: options.sleep, limiter, transport: options.transport },
    }) }).forProtocol("rest");
    const snapshot = await connector.syncActivity({ vendorAccountId: account.id, observedAt });
    if (!snapshot.ok) {
     if (snapshot.code === "unsupported") throw new Error("ACTIVITY_ACCOUNT_UNSUPPORTED");
     throw Object.assign(new Error("ACTIVITY_PROVIDER_ERROR"), { code: "SYNC_STALE", vendorAccountId: account.id, retryable: snapshot.retryable });
    }
    const client = await pool.connect();
    try {
     await client.query("BEGIN");
     // Keep the opt-in locked throughout rows AND global warnings, preventing
     // an excluded in-flight snapshot from leaving either durable artifact.
     const active = await client.query(`SELECT account.id FROM vendor_account account JOIN vendor ON vendor.id=account.vendor_id WHERE account.id=$1::uuid AND account.ingestion_mode='api' AND account.status='active' AND vendor.status='active' AND vendor.has_usage_data AND vendor.connector_type='api' AND vendor.provisioning_protocol='rest' AND vendor.identity_matching='email' FOR SHARE OF account,vendor`, [account.id]);
     if (active.rowCount === 0) { await client.query("ROLLBACK"); continue; }
     const db = drizzle(client, { schema });
     const routed = await resolveActivityScopes(db, trustedCompanyIds, snapshot.value.records);
     let written = 0;
     for (const batch of routed.batches) written += (await ingestActivityBatch(db, { ...batch, vendorAccountId: account.id, activityDate, source: "api", syncedAt, actorUserAccountId: null })).written;
     for (const warning of routed.warnings) await db.insert(schema.auditLog).values({ actorUserId: SYSTEM_USER_ID, action: "analytics_identity_warning", entityType: "VendorAccount", entityId: account.id, companyId: null, occurredAt: syncedAt, after: { vendorAccountId: account.id, activityDate, reason: warning.reason, identity: { email: warning.email, providerUserId: warning.providerUserId } } });
     await client.query("COMMIT"); processed += written;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
   }
   return { processed };
  },
 });
}
