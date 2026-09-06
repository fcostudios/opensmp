import pg from "pg";

import {
  buildConnectorCallSummary,
  type ConnectorCallObservationAppender,
} from "@smp/connectors/connector-call-observation";

export {
  connector_call_operation_enum,
  connector_call_phase_enum,
  connectorCallObservation,
} from "./schema.js";

const insertConnectorCallObservation = `
  INSERT INTO connector_call_observation (
    vendor_account_id,
    provisioning_action_id,
    correlation_id,
    operation,
    attempt,
    phase,
    classification,
    summary,
    occurred_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
`;

export function createConnectorCallObservationAppender(connectionString: string): Readonly<{
  append: ConnectorCallObservationAppender;
  close(): Promise<void>;
}> {
  const pool = new pg.Pool({ connectionString });

  const append: ConnectorCallObservationAppender = async (input) => {
    const summary = buildConnectorCallSummary({
      phase: input.phase,
      endpointClass: input.summary.endpoint_class,
      method: input.summary.method,
      httpStatus: input.summary.http_status,
      classification: input.summary.status_class,
    });
    await pool.query(insertConnectorCallObservation, [
      input.vendorAccountId,
      input.provisioningActionId,
      input.correlationId,
      input.operation,
      input.attempt,
      input.phase,
      input.classification,
      JSON.stringify(summary),
      input.occurredAt,
    ]);
  };

  return Object.freeze({
    append,
    close: pool.end.bind(pool),
  });
}
